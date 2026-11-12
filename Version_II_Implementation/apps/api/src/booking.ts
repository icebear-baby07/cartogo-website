import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { Router, type Request, type Response } from "express";
import nodemailer, { type SendMailOptions } from "nodemailer";
import { emailVerificationEmail, inquiryConfirmationEmail } from "./email-templates.js";
import {
  withEmailActivity,
  type EmailActivityRecorder,
} from "./email-activity.js";

type BookingUnit = {
  id: number;
  display_name: string;
  capacity: number;
  in12_rate: number;
  in24_rate: number;
  out12_rate: number;
  out24_rate: number;
  luzon_rate: number;
};

export class BookingAuthError extends Error {
  constructor(
    public readonly status: 400 | 401 | 503,
    message: string,
  ) {
    super(message);
    this.name = "BookingAuthError";
  }
}

type Inquiry = Record<string, unknown> & { id: number; email: string };

export type VerifiedGoogleUser = {
  id: string;
  email: string;
  name: string;
};

export type BookingRepository = {
  getUnit(id: number): Promise<BookingUnit | null>;
  getBookingPricing(): Promise<{
    discountRules: Array<{ minDays: number; maxDays: number; percent: number }>;
    extraDriverFee: number;
    childSeatFee: number;
  }>;
  findInquiryByRequestId(requestId: string): Promise<Inquiry | null>;
  createGuestChallenge(challenge: GuestChallenge): Promise<void>;
  getGuestChallenge(id: string): Promise<GuestChallenge | null>;
  incrementGuestChallengeAttempts(id: string, now: Date): Promise<number | null>;
  saveGuestChallengeVerification(id: string, tokenHash: string, now: Date): Promise<boolean>;
  deleteGuestChallenge(id: string): Promise<void>;
  consumeGuestChallenge(id: string, email: string, tokenHash: string, now: Date): Promise<boolean>;
  releaseGuestChallenge(id: string, email: string, tokenHash: string): Promise<void>;
  addInquiry(inquiry: Record<string, unknown>, requestId: string): Promise<Inquiry>;
  enqueueInquiryConfirmation(inquiry: Inquiry): Promise<void>;
  claimInquiryConfirmation(now: Date): Promise<EmailOutboxItem | null>;
  completeInquiryConfirmation(id: string, now: Date): Promise<void>;
  retryInquiryConfirmation(id: string, attempts: number, error: string, now: Date): Promise<void>;
};

export type GuestChallenge = {
  id: string;
  email: string;
  ip_hash: string;
  code_hash: string;
  expires_at: Date;
  created_at: Date;
  attempts: number;
  verified_at?: Date;
  token_hash?: string;
  consumed_at?: Date;
};

export type EmailOutboxItem = {
  _id: string;
  attempts: number;
  inquiry: Inquiry;
};

type BookingApiOptions = {
  smtpUser?: string;
  smtpPassword?: string;
  smtpHost?: string;
  smtpPort?: string;
  smtpFrom?: string;
  verificationSecret?: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  verifyGoogleUser?: (accessToken: string) => Promise<VerifiedGoogleUser>;
  sendMail?: (options: SendMailOptions) => Promise<void>;
  recordEmailActivity?: EmailActivityRecorder;
};

export async function verifyGoogleBookingUser(
  accessToken: string,
  config: { supabaseUrl?: string; supabaseAnonKey?: string },
  fetcher: typeof fetch = fetch,
): Promise<VerifiedGoogleUser> {
  const supabaseUrl = config.supabaseUrl?.trim().replace(/\/+$/, "");
  const anonKey = config.supabaseAnonKey?.trim();
  if (!supabaseUrl || !anonKey) {
    throw new BookingAuthError(503, "Google booking sign-in is not configured on the API.");
  }
  let response: globalThis.Response;
  try {
    response = await fetcher(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new BookingAuthError(503, "Google sign-in verification is temporarily unavailable.");
  }
  if (response.status === 401 || response.status === 403) {
    throw new BookingAuthError(401, "Your Google sign-in has expired. Sign in again.");
  }
  if (!response.ok) {
    throw new BookingAuthError(503, "Google sign-in could not be verified.");
  }
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new BookingAuthError(503, "The identity provider returned an invalid response.");
  }
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.email !== "string") {
    throw new BookingAuthError(401, "The signed-in account could not be verified.");
  }
  const appMetadata = isRecord(value.app_metadata) ? value.app_metadata : {};
  const userMetadata = isRecord(value.user_metadata) ? value.user_metadata : {};
  const identities = Array.isArray(value.identities) ? value.identities : [];
  const providers = [
    appMetadata.provider,
    ...(Array.isArray(appMetadata.providers) ? appMetadata.providers : []),
    ...identities.filter(isRecord).map((identity) => identity.provider),
  ];
  const verifiedEmail = userMetadata.email_verified === true ||
    userMetadata.email_verified === "true" ||
    Boolean(value.email_confirmed_at || value.confirmed_at);
  if (!providers.includes("google") || !verifiedEmail) {
    throw new BookingAuthError(401, "A verified Google account is required to submit an inquiry.");
  }
  const fullName = String(userMetadata.full_name || userMetadata.name || "").trim();
  const name = fullName || [
    userMetadata.given_name,
    userMetadata.middle_name,
    userMetadata.family_name,
  ].filter((part): part is string => typeof part === "string" && Boolean(part.trim()))
    .map((part) => part.trim())
    .join(" ");
  if (!name || name.length > 160) {
    throw new BookingAuthError(400, "Your verified Google profile must include a name up to 160 characters.");
  }
  return { id: value.id, email: value.email.trim().toLowerCase(), name };
}

export function createBookingMailer(options: BookingApiOptions): (message: SendMailOptions) => Promise<void> {
  if (options.sendMail) return options.sendMail;
  const user = options.smtpUser?.trim();
  const password = options.smtpPassword?.trim().replace(/\s+/g, "");
  const from = options.smtpFrom?.trim() || user;
  const transport = nodemailer.createTransport({
    host: options.smtpHost || "smtp.gmail.com",
    port: Number(options.smtpPort || 587),
    secure: Number(options.smtpPort || 587) === 465,
    disableFileAccess: true,
    disableUrlAccess: true,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 10_000,
    auth: user && password
      ? { user, pass: password }
      : undefined,
  });
  return async (message) => {
    if (!user || !password || !from) {
      throw new Error("SMTP is not configured for booking email.");
    }
    await transport.sendMail({ from, ...message });
  };
}

export async function runInquiryConfirmationWorker(
  repository: BookingRepository,
  sendMail: (message: SendMailOptions) => Promise<void>,
  recordActivity?: EmailActivityRecorder,
): Promise<boolean> {
  const now = new Date();
  const item = await repository.claimInquiryConfirmation(now);
  if (!item) return false;
  const inquiry = item.inquiry;
  const message = inquiryConfirmationEmail(inquiry);
  try {
    await withEmailActivity(recordActivity, "inquiry_confirmation", () => sendMail({
      to: inquiry.email,
      subject: "We received your carTOGO.mnl inquiry",
      ...message,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Unknown email delivery error";
    await repository.retryInquiryConfirmation(item._id, item.attempts, message, new Date());
    console.error("Inquiry confirmation email delivery failed.", error instanceof Error ? error.name : "UnknownError");
    return true;
  }
  await repository.completeInquiryConfirmation(item._id, new Date());
  return true;
}

const challengeTtlMs = 10 * 60 * 1000;

class BookingInputError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hashVerificationCode(challengeId: string, code: string, secret: string): string {
  return createHmac("sha256", secret).update(`${challengeId}:${code}`).digest("hex");
}

function text(value: unknown, label: string, maximum: number, required = true): string | null {
  if (value === undefined || value === null) {
    if (!required) return null;
    throw new BookingInputError(`${label} is required.`);
  }
  if (typeof value !== "string") throw new BookingInputError(`${label} must be text.`);
  const result = value.trim();
  if ((required && !result) || result.length > maximum) {
    throw new BookingInputError(`${label} must be non-empty and no longer than ${maximum} characters.`);
  }
  return result || null;
}

function finiteNumber(value: unknown, label: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new BookingInputError(`${label} is outside the accepted range.`);
  }
  return value;
}

function validDate(value: string, label: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BookingInputError(`${label} must use YYYY-MM-DD format.`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    throw new BookingInputError(`${label} must be a valid date.`);
  }
  return date;
}

function normalizeInquiry(
  payload: Record<string, unknown>,
  unit: BookingUnit,
  pricing: Awaited<ReturnType<BookingRepository["getBookingPricing"]>>,
  googleUser: VerifiedGoogleUser | null,
): Inquiry {
  let name: string;
  let email: string;
  if (googleUser) {
    name = googleUser.name;
    email = googleUser.email;
  } else {
    const firstName = text(payload.firstName, "First name", 80)!;
    const lastName = text(payload.lastName, "Last name", 80)!;
    const middleName = text(payload.middleName, "Middle name", 80, false);
    const suffix = text(payload.suffix, "Suffix", 24, false);
    name = `${lastName}, ${[firstName, middleName].filter(Boolean).join(" ")}${suffix ? `, ${suffix}` : ""}`;
    if (name.length > 160) throw new BookingInputError("Name must be no longer than 160 characters.");
    email = text(payload.email, "Email", 254)!.toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new BookingInputError("Enter a valid email address.");
  }

  const phone = text(payload.phone, "Phone number", 24)!;
  const phoneDigits = phone.replace(/\D/g, "");
  if (phoneDigits.length < 7 || phoneDigits.length > 15) {
    throw new BookingInputError("Enter a phone number with 7 to 15 digits.");
  }

  const pickupDate = text(payload.pickupDate, "Pickup date", 10)!;
  const returnDate = text(payload.returnDate, "Return date", 10)!;
  const pickupDay = validDate(pickupDate, "Pickup date");
  const returnDay = validDate(returnDate, "Return date");
  if (returnDay < pickupDay) throw new BookingInputError("Return date can't be earlier than the pickup date.");
  const pickupTime = text(payload.pickupTime, "Pickup time", 5)!;
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(pickupTime)) {
    throw new BookingInputError("Pickup time must use 24-hour HH:MM format.");
  }

  const requestedRateRegion = text(payload.rateRegion, "Rate region", 16)!;
  const rateRegion = requestedRateRegion === "in"
    ? "inside"
    : requestedRateRegion === "out"
      ? "outside"
      : requestedRateRegion;
  if (!["inside", "outside", "luzon"].includes(rateRegion)) {
    throw new BookingInputError("Choose a valid rate region.");
  }
  const rentalMode = payload.rentalMode;
  if (rentalMode !== "hourly" && rentalMode !== "custom_days") {
    throw new BookingInputError("Choose an hourly or custom-day rental arrangement.");
  }
  const period = finiteNumber(payload.rentalPeriodHours, "Rental period", 1, 24);
  if (period !== 12 && period !== 24) throw new BookingInputError("Rental period must be 12 or 24 hours.");
  const rentalDays = finiteNumber(payload.rentalDays, "Rental days", 1, 15);
  if (!Number.isInteger(rentalDays)) throw new BookingInputError("Rental days must be a whole number.");
  if (rentalMode === "custom_days" && (rentalDays < 4 || period !== 24)) {
    throw new BookingInputError("Custom-day rentals must use a 4–15 day duration and 24-hour rates.");
  }
  if (rentalMode === "hourly" && (rentalDays !== 1 || rateRegion === "luzon")) {
    throw new BookingInputError("Hourly rentals must use one 12- or 24-hour block outside Luzon.");
  }

  const elapsedDays = Math.round((returnDay.valueOf() - pickupDay.valueOf()) / 86_400_000);
  const pickupMinutes = Number(pickupTime.slice(0, 2)) * 60 + Number(pickupTime.slice(3));
  const expectedElapsedDays = rentalMode === "custom_days"
    ? rentalDays
    : Math.floor((pickupMinutes + period * 60) / 1440);
  if (elapsedDays !== expectedElapsedDays) {
    throw new BookingInputError("The return date must match the selected rental duration.");
  }

  const rate = rateRegion === "inside"
    ? (period === 12 ? unit.in12_rate : unit.in24_rate)
    : rateRegion === "outside"
      ? (period === 12 ? unit.out12_rate : unit.out24_rate)
      : unit.luzon_rate;
  const discountPercent = rentalMode === "custom_days"
    ? pricing.discountRules.find((rule) => rentalDays >= rule.minDays && rentalDays <= rule.maxDays)?.percent ?? 0
    : 0;
  const undiscounted = rate * (rentalMode === "custom_days" ? rentalDays : 1);
  const discountAmount = Math.round(undiscounted * discountPercent) / 100;
  const rentalSubtotal = undiscounted - discountAmount;
  const extraDriver = payload.extraDriver ?? false;
  const childSeat = payload.childSeat ?? false;
  if (typeof extraDriver !== "boolean" || typeof childSeat !== "boolean") {
    throw new BookingInputError("Choose valid options for the optional add-ons.");
  }
  const extraDriverFee = extraDriver ? pricing.extraDriverFee : 0;
  const childSeatFee = childSeat ? pricing.childSeatFee : 0;
  const quotedRate = rentalSubtotal + extraDriverFee + childSeatFee;
  const reportedRate = finiteNumber(payload.ratePerPeriod, "Rate per period", 0, 99_999_999.99);
  const reportedDiscount = finiteNumber(payload.discountAmount, "Discount amount", 0, 9_999_999_999.99);
  const reportedQuote = finiteNumber(payload.quotedRate, "Quoted rate", 0, 9_999_999_999.99);
  if (reportedRate !== rate || reportedDiscount !== discountAmount || reportedQuote !== quotedRate) {
    throw new BookingInputError("The displayed quote is out of date. Refresh the rate estimate and try again.");
  }
  const reportedDiscountPercent = finiteNumber(payload.discountPercent, "Discount percent", 0, 10);
  const estimatedHours = finiteNumber(payload.estimatedRentalHours, "Estimated rental hours", 1, 360);
  if (
    reportedDiscountPercent !== discountPercent ||
    estimatedHours !== (rentalMode === "custom_days" ? rentalDays * 24 : period)
  ) {
    throw new BookingInputError("The displayed rental duration is out of date. Refresh the estimate and try again.");
  }

  const clientUnitId = text(payload.carId, "Vehicle ID", 80)!;
  if (clientUnitId !== String(unit.id)) throw new BookingInputError("The selected vehicle has changed. Please select it again.");
  const clientCapacity = payload.capacity === null || payload.capacity === undefined
    ? unit.capacity
    : finiteNumber(payload.capacity, "Capacity", 1, 2_147_483_647);
  if (clientCapacity !== unit.capacity) throw new BookingInputError("Vehicle capacity has changed. Please select it again.");
  const requestedCapacity = payload.requestedCapacity === null || payload.requestedCapacity === undefined
    ? null
    : finiteNumber(payload.requestedCapacity, "Requested seats", 1, 2_147_483_647);
  if (
    requestedCapacity !== null &&
    (!Number.isInteger(requestedCapacity) || requestedCapacity > unit.capacity)
  ) {
    throw new BookingInputError("The selected vehicle does not meet the requested seat count.");
  }

  return {
    name,
    email,
    phone,
    secondary_phone: text(payload.secondaryPhone, "Secondary phone", 24, false),
    car_id: String(unit.id),
    car_name: unit.display_name,
    capacity: unit.capacity,
    requested_capacity: requestedCapacity,
    pickup_date: pickupDate,
    pickup_time: pickupTime,
    return_date: returnDate,
    rate_region: rateRegion,
    rental_period_hours: period,
    rental_mode: rentalMode,
    estimated_rental_hours: estimatedHours,
    rate_per_period: rate,
    rental_days: rentalDays,
    discount_percent: discountPercent,
    discount_amount: discountAmount,
    rental_subtotal: rentalSubtotal,
    extra_driver: extraDriver,
    extra_driver_fee: extraDriverFee,
    child_seat: childSeat,
    child_seat_fee: childSeatFee,
    quoted_rate: quotedRate,
    notes: text(payload.notes, "Notes", 2000, false),
    status: "pending_review",
    verification_method: googleUser ? "google_oauth" : "email_otp",
    user_id: googleUser?.id ?? null,
    id: 0,
  };
}

function sendError(response: Response, status: number, error: string): void {
  response.status(status).json({ error });
}

export function createBookingRouter(
  getRepository: () => Promise<BookingRepository>,
  options: BookingApiOptions = {},
): Router {
  const router = Router();
  const sendMail = createBookingMailer(options);
  const verificationSecret = options.verificationSecret?.trim()
    || options.smtpPassword?.trim().replace(/\s+/g, "");

  router.post("/public/email-verification/request", async (request, response) => {
    try {
      if (!isRecord(request.body)) {
        sendError(response, 400, "Provide an email address.");
        return;
      }
      const email = text(request.body.email, "Email", 254)!.toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        sendError(response, 400, "Enter a valid email address.");
        return;
      }
      if (!verificationSecret) {
        sendError(response, 503, "Email verification is not configured.");
        return;
      }
      const repository = await getRepository();
      const now = new Date();
      const challenge: GuestChallenge = {
        id: randomUUID(),
        email,
        ip_hash: digest(request.ip || request.socket.remoteAddress || "unknown"),
        code_hash: "",
        expires_at: new Date(now.valueOf() + challengeTtlMs),
        created_at: now,
        attempts: 0,
      };
      const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
      challenge.code_hash = hashVerificationCode(challenge.id, code, verificationSecret);
      try {
        await repository.createGuestChallenge(challenge);
      } catch (error) {
        if (error instanceof Error && error.message === "rate_limited") {
          sendError(response, 429, "Wait 60 seconds before requesting another verification code.");
          return;
        }
        throw error;
      }
      try {
        const message = emailVerificationEmail(code);
        await withEmailActivity(options.recordEmailActivity, "email_verification", () => sendMail({
          to: email,
          subject: "Verify your email | carTOGO.mnl",
          ...message,
        }));
      } catch (error) {
        await repository.deleteGuestChallenge(challenge.id);
        console.error("Could not send booking email verification.", error instanceof Error ? error.name : "UnknownError");
        sendError(response, 503, "We couldn't send the verification email. Please try again later.");
        return;
      }
      response.status(201).json({ challengeId: challenge.id, expiresInSeconds: 600 });
    } catch (error) {
      if (error instanceof BookingInputError) {
        sendError(response, 400, error.message);
        return;
      }
      console.error("Could not create booking email verification.", error instanceof Error ? error.name : "UnknownError");
      sendError(response, 503, "Email verification is temporarily unavailable.");
    }
  });

  router.post("/public/email-verification/verify", async (request, response) => {
    try {
      if (!isRecord(request.body)) {
        sendError(response, 400, "Provide the verification details.");
        return;
      }
      const challengeId = text(request.body.challengeId, "Challenge ID", 64)!;
      const code = text(request.body.code, "Verification code", 6)!;
      if (!/^\d{6}$/.test(code)) {
        sendError(response, 400, "Enter the 6-digit verification code.");
        return;
      }
      if (!verificationSecret) {
        sendError(response, 503, "Email verification is not configured.");
        return;
      }
      const repository = await getRepository();
      const challenge = await repository.getGuestChallenge(challengeId);
      if (!challenge || challenge.expires_at <= new Date() || challenge.verified_at) {
        sendError(response, 400, "That verification code has expired or was already used. Request a new code.");
        return;
      }
      const attempts = await repository.incrementGuestChallengeAttempts(challengeId, new Date());
      if (attempts === null) {
        sendError(response, 429, "Too many attempts. Request a new verification code.");
        return;
      }
      const expected = Buffer.from(challenge.code_hash, "hex");
      const supplied = Buffer.from(hashVerificationCode(challenge.id, code, verificationSecret), "hex");
      if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
        sendError(response, 400, "That verification code is incorrect.");
        return;
      }
      const token = randomBytes(32).toString("base64url");
      if (!await repository.saveGuestChallengeVerification(challenge.id, digest(token), new Date())) {
        sendError(response, 400, "That verification code has expired or was already used. Request a new code.");
        return;
      }
      response.json({ verificationToken: token });
    } catch (error) {
      if (error instanceof BookingInputError) {
        sendError(response, 400, error.message);
        return;
      }
      console.error("Could not verify booking email.", error instanceof Error ? error.name : "UnknownError");
      sendError(response, 503, "Email verification is temporarily unavailable.");
    }
  });

  router.post("/public/inquiries", async (request, response) => {
    try {
      if (!isRecord(request.body)) {
        sendError(response, 400, "Provide a valid booking inquiry.");
        return;
      }
      const requestId = text(request.body.clientRequestId, "Request ID", 64)!;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
        sendError(response, 400, "A valid request ID is required.");
        return;
      }
      let googleUser: VerifiedGoogleUser | null = null;
      const authorization = request.get("authorization") ?? "";
      if (authorization) {
        const match = /^Bearer\s+(\S+)$/i.exec(authorization);
        if (!match || !options.verifyGoogleUser) {
          sendError(response, 401, "Google booking sign-in could not be verified.");
          return;
        }
        try {
          googleUser = await options.verifyGoogleUser(match[1]);
        } catch (error) {
          if (error instanceof BookingAuthError) {
            sendError(response, error.status, error.message);
            return;
          }
          console.error("Could not verify Google booking account.", error instanceof Error ? error.name : "UnknownError");
          sendError(response, 503, "Google sign-in verification is temporarily unavailable.");
          return;
        }
      }
      const email = googleUser?.email ?? text(request.body.email, "Email", 254)!.toLowerCase();
      const repository = await getRepository();
      const existing = await repository.findInquiryByRequestId(requestId);
      if (existing) {
        if (existing.email.toLowerCase() !== email) {
          sendError(response, 409, "That request ID is already associated with another inquiry.");
          return;
        }
        response.json({ inquiry: existing, emailNotificationQueued: true, duplicate: true });
        return;
      }
      const unitIdRaw = text(request.body.carId, "Vehicle ID", 80)!;
      if (!/^\d+$/.test(unitIdRaw) || Number(unitIdRaw) < 1) {
        sendError(response, 400, "Choose a valid vehicle.");
        return;
      }
      const unit = await repository.getUnit(Number(unitIdRaw));
      if (!unit) {
        sendError(response, 400, "That vehicle is no longer available. Refresh and choose another.");
        return;
      }
      const inquiry = normalizeInquiry(
        request.body,
        unit,
        await repository.getBookingPricing(),
        googleUser,
      );
      if (inquiry.email !== email) {
        sendError(response, 400, "The verified email does not match the inquiry email.");
        return;
      }
      let challengeId: string | null = null;
      let verificationToken: string | null = null;
      if (!googleUser) {
        challengeId = text(request.body.challengeId, "Challenge ID", 64)!;
        verificationToken = text(request.body.verificationToken, "Verification token", 128)!;
        if (!await repository.consumeGuestChallenge(
          challengeId,
          email,
          digest(verificationToken),
          new Date(),
        )) {
          sendError(response, 403, "Verify your email address before sending this inquiry.");
          return;
        }
      }
      let created: Inquiry;
      try {
        created = await repository.addInquiry(inquiry, requestId);
      } catch (error) {
        if (challengeId && verificationToken) {
          await repository.releaseGuestChallenge(challengeId, email, digest(verificationToken));
        }
        throw error;
      }
      if (created.email.toLowerCase() !== email) {
        if (challengeId && verificationToken) {
          await repository.releaseGuestChallenge(challengeId, email, digest(verificationToken));
        }
        sendError(response, 409, "That request ID is already associated with another inquiry.");
        return;
      }
      try {
        await repository.enqueueInquiryConfirmation(created);
      } catch (error) {
        console.error("Inquiry was saved but confirmation could not be queued.", error instanceof Error ? error.name : "UnknownError");
        response.status(201).json({ inquiry: created, emailNotificationQueued: false });
        return;
      }
      response.status(201).json({ inquiry: created, emailNotificationQueued: true });
    } catch (error) {
      if (error instanceof BookingInputError) {
        sendError(response, 400, error.message);
        return;
      }
      console.error("Could not submit booking inquiry.", error instanceof Error ? error.name : "UnknownError");
      sendError(response, 503, "Booking inquiries are temporarily unavailable.");
    }
  });

  return router;
}
