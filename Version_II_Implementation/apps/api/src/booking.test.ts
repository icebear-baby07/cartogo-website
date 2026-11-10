import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import test from "node:test";
import type { SendMailOptions } from "nodemailer";
import {
  BookingAuthError,
  createBookingRouter,
  runInquiryConfirmationWorker,
  verifyGoogleBookingUser,
  type BookingRepository,
  type EmailOutboxItem,
  type GuestChallenge,
} from "./booking.js";

const requestId = "b51af624-97a3-4f2b-88a2-98ec103ca09a";

function createRepository(): BookingRepository {
  const challenges = new Map<string, GuestChallenge & { consumed_at?: Date }>();
  const inquiries = new Map<string, Record<string, unknown> & { id: number; email: string }>();
  const outbox: EmailOutboxItem[] = [];
  let nextId = 40;
  return {
    async getUnit(id) {
      return id === 1 ? {
        id: 1,
        display_name: "Honda City",
        capacity: 5,
        in12_rate: 1000,
        in24_rate: 1800,
        out12_rate: 1400,
        out24_rate: 2400,
        luzon_rate: 3000,
      } : null;
    },
    async getBookingPricing() {
      return {
        discountRules: [
          { minDays: 4, maxDays: 7, percent: 5 },
          { minDays: 8, maxDays: 15, percent: 10 },
        ],
        extraDriverFee: 300,
        childSeatFee: 150,
      };
    },
    async findInquiryByRequestId(id) {
      return inquiries.get(id) ?? null;
    },
    async createGuestChallenge(challenge) {
      const recent = [...challenges.values()].some((item) =>
        item.email === challenge.email && Date.now() - item.created_at.valueOf() < 60_000,
      );
      if (recent) throw new Error("rate_limited");
      challenges.set(challenge.id, challenge);
    },
    async getGuestChallenge(id) {
      return challenges.get(id) ?? null;
    },
    async incrementGuestChallengeAttempts(id, now) {
      const challenge = challenges.get(id);
      if (!challenge || challenge.expires_at <= now || challenge.verified_at || challenge.attempts >= 5) return null;
      challenge.attempts += 1;
      return challenge.attempts;
    },
    async saveGuestChallengeVerification(id, tokenHash, now) {
      const challenge = challenges.get(id);
      if (!challenge || challenge.expires_at <= now || challenge.verified_at) return false;
      challenge.verified_at = now;
      challenge.token_hash = tokenHash;
      return true;
    },
    async deleteGuestChallenge(id) {
      challenges.delete(id);
    },
    async consumeGuestChallenge(id, email, tokenHash, now) {
      const challenge = challenges.get(id);
      if (
        !challenge || challenge.email !== email || challenge.token_hash !== tokenHash ||
        !challenge.verified_at || challenge.consumed_at || challenge.expires_at <= now
      ) return false;
      challenge.consumed_at = now;
      return true;
    },
    async releaseGuestChallenge(id, email, tokenHash) {
      const challenge = challenges.get(id);
      if (challenge?.email === email && challenge.token_hash === tokenHash) delete challenge.consumed_at;
    },
    async addInquiry(inquiry, id) {
      const existing = inquiries.get(id);
      if (existing) return existing;
      const result = {
        ...inquiry,
        id: ++nextId,
        email: String(inquiry.email),
        created_at: new Date().toISOString(),
      };
      inquiries.set(id, result);
      return result;
    },
    async enqueueInquiryConfirmation(inquiry) {
      outbox.push({ _id: `inquiry-confirmation:${inquiry.id}`, inquiry, attempts: 0 });
    },
    async claimInquiryConfirmation() {
      return outbox.shift() ?? null;
    },
    async completeInquiryConfirmation() {},
    async retryInquiryConfirmation() {},
  };
}

async function post(
  router: express.Router,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    return await fetch(`http://127.0.0.1:${address.port}/api${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function inquiryPayload(challengeId: string, verificationToken: string) {
  return {
    clientRequestId: requestId,
    challengeId,
    verificationToken,
    email: "renter@example.com",
    firstName: "Alex",
    lastName: "Renter",
    phone: "+63 912 345 6789",
    carId: "1",
    capacity: 5,
    requestedCapacity: null,
    pickupDate: "2026-11-10",
    pickupTime: "09:00",
    returnDate: "2026-11-10",
    rateRegion: "in",
    rentalMode: "hourly",
    rentalPeriodHours: 12,
    estimatedRentalHours: 12,
    ratePerPeriod: 1000,
    rentalDays: 1,
    discountPercent: 0,
    discountAmount: 0,
    extraDriver: false,
    childSeat: false,
    quotedRate: 1000,
    notes: "",
  };
}

test("sends a guest verification code and accepts it once", async () => {
  const repository = createRepository();
  let sentMessage: SendMailOptions | undefined;
  const emailActivities: string[] = [];
  const router = createBookingRouter(async () => repository, {
    verificationSecret: "test-verification-secret",
    sendMail: async (message) => { sentMessage = message; },
    recordEmailActivity: async (type, activity) => { emailActivities.push(`${type}:${activity}`); },
  });
  const requested = await post(router, "/public/email-verification/request", { email: "Renter@example.com" });
  assert.equal(requested.status, 201);
  const { challengeId } = await requested.json() as { challengeId: string };
  assert.equal(sentMessage?.to, "renter@example.com");
  assert.match(String(sentMessage?.subject), /Verify your email/);
  assert.match(String(sentMessage?.html), /carTOGO<span/);
  assert.deepEqual(emailActivities, ["email_verification:attempted", "email_verification:sent"]);
  const code = String(sentMessage?.text).match(/\b\d{6}\b/)?.[0];
  assert.ok(code);

  const verified = await post(router, "/public/email-verification/verify", { challengeId, code });
  assert.equal(verified.status, 200);
  const { verificationToken } = await verified.json() as { verificationToken: string };
  assert.ok(verificationToken);

  const reused = await post(router, "/public/email-verification/verify", { challengeId, code });
  assert.equal(reused.status, 400);
});

test("saves a server-priced inquiry once and queues its confirmation", async () => {
  const repository = createRepository();
  let sentMessage: SendMailOptions | undefined;
  const router = createBookingRouter(async () => repository, {
    verificationSecret: "test-verification-secret",
    sendMail: async (message) => { sentMessage = message; },
  });
  const requested = await post(router, "/public/email-verification/request", { email: "renter@example.com" });
  const { challengeId } = await requested.json() as { challengeId: string };
  const code = String(sentMessage?.text).match(/\b\d{6}\b/)?.[0]!;
  const verified = await post(router, "/public/email-verification/verify", { challengeId, code });
  const { verificationToken } = await verified.json() as { verificationToken: string };
  const payload = {
    ...inquiryPayload(challengeId, verificationToken),
    requestedCapacity: 4,
  };

  const submitted = await post(router, "/public/inquiries", payload);
  assert.equal(submitted.status, 201);
  const result = await submitted.json() as {
    inquiry: Record<string, unknown> & { id: number };
    emailNotificationQueued: boolean;
  };
  assert.equal(result.inquiry.id, 41);
  assert.equal(result.inquiry.car_name, "Honda City");
  assert.equal(result.inquiry.requested_capacity, 4);
  assert.equal(result.inquiry.status, "pending_review");
  assert.equal(result.emailNotificationQueued, true);

  const duplicate = await post(router, "/public/inquiries", payload);
  assert.equal(duplicate.status, 200);
  assert.equal((await duplicate.json() as { duplicate: boolean }).duplicate, true);
});

test("rejects a client quote that differs from database rates", async () => {
  const repository = createRepository();
  let sentMessage: SendMailOptions | undefined;
  const router = createBookingRouter(async () => repository, {
    verificationSecret: "test-verification-secret",
    sendMail: async (message) => { sentMessage = message; },
  });
  const requested = await post(router, "/public/email-verification/request", { email: "renter@example.com" });
  const { challengeId } = await requested.json() as { challengeId: string };
  const code = String(sentMessage?.text).match(/\b\d{6}\b/)?.[0]!;
  const verified = await post(router, "/public/email-verification/verify", { challengeId, code });
  const { verificationToken } = await verified.json() as { verificationToken: string };
  const payload = inquiryPayload(challengeId, verificationToken);
  payload.ratePerPeriod = 999;
  const response = await post(router, "/public/inquiries", payload);
  assert.equal(response.status, 400);
  assert.match((await response.json() as { error: string }).error, /out of date/);
});

test("rejects an add-on quote that omits its server-configured fee", async () => {
  const router = createBookingRouter(async () => createRepository(), {
    verificationSecret: "test-verification-secret",
    sendMail: async () => {},
  });
  const payload = {
    ...inquiryPayload("unverified-challenge", "unverified-token"),
    extraDriver: true,
  };
  const response = await post(router, "/public/inquiries", payload);
  assert.equal(response.status, 400);
  assert.match((await response.json() as { error: string }).error, /out of date/);
});

test("does not submit an inquiry without a verified email", async () => {
  const repository = createRepository();
  const router = createBookingRouter(async () => repository, {
    verificationSecret: "test-verification-secret",
    sendMail: async () => {},
  });
  const response = await post(
    router,
    "/public/inquiries",
    inquiryPayload("unknown-challenge", "unverified-token"),
  );
  assert.equal(response.status, 403);
});

test("uses the renter-selected rate area and calculates the quote from database rates", async () => {
  const repository = createRepository();
  let sentMessage: SendMailOptions | undefined;
  const router = createBookingRouter(async () => repository, {
    verificationSecret: "test-verification-secret",
    sendMail: async (message) => { sentMessage = message; },
  });
  const requested = await post(router, "/public/email-verification/request", { email: "renter@example.com" });
  const { challengeId } = await requested.json() as { challengeId: string };
  const code = String(sentMessage?.text).match(/\b\d{6}\b/)?.[0]!;
  const verified = await post(router, "/public/email-verification/verify", { challengeId, code });
  const { verificationToken } = await verified.json() as { verificationToken: string };
  const payload = {
    ...inquiryPayload(challengeId, verificationToken),
    rateRegion: "out",
    ratePerPeriod: 1400,
    extraDriver: true,
    childSeat: true,
    quotedRate: 1850,
  };
  const response = await post(
    router,
    "/public/inquiries",
    payload,
  );
  assert.equal(response.status, 201);
  const result = await response.json() as { inquiry: Record<string, unknown> };
  assert.equal(result.inquiry.rate_region, "out");
  assert.equal(result.inquiry.rate_per_period, 1400);
  assert.equal(result.inquiry.extra_driver, true);
  assert.equal(result.inquiry.extra_driver_fee, 300);
  assert.equal(result.inquiry.child_seat, true);
  assert.equal(result.inquiry.child_seat_fee, 150);
  assert.equal(result.inquiry.rental_subtotal, 1400);
  assert.equal(result.inquiry.quoted_rate, 1850);
});

test("rejects unsupported renter-selected rate areas", async () => {
  const router = createBookingRouter(async () => createRepository(), {
    verificationSecret: "test-verification-secret",
    sendMail: async () => {},
  });
  const payload = { ...inquiryPayload("unknown-challenge", "unverified-token"), rateRegion: "not-a-region" };
  const response = await post(
    router,
    "/public/inquiries",
    payload,
  );
  assert.equal(response.status, 400);
  assert.match((await response.json() as { error: string }).error, /valid rate region/i);
});

test("accepts a verified Google booking without guest OTP and uses the verified profile", async () => {
  const repository = createRepository();
  const router = createBookingRouter(async () => repository, {
    verifyGoogleUser: async (token) => {
      assert.equal(token, "google-access-token");
      return {
        id: "supabase-user-123",
        email: "renter@example.com",
        name: "Alex Verified",
      };
    },
    sendMail: async () => {},
  });
  const response = await post(
    router,
    "/public/inquiries",
    inquiryPayload("", ""),
    { Authorization: "Bearer google-access-token" },
  );
  assert.equal(response.status, 201);
  const result = await response.json() as { inquiry: Record<string, unknown> };
  assert.equal(result.inquiry.name, "Alex Verified");
  assert.equal(result.inquiry.email, "renter@example.com");
  assert.equal(result.inquiry.user_id, "supabase-user-123");
  assert.equal(result.inquiry.verification_method, "google_oauth");
});

test("verifies Supabase Google identity and rejects other providers", async () => {
  const fetcher: typeof fetch = async () => Response.json({
    id: "user-456",
    email: "renter@example.com",
    app_metadata: { provider: "google", providers: ["google"] },
    user_metadata: { full_name: "Alex Renter", email_verified: true },
  });
  const verified = await verifyGoogleBookingUser(
    "access-token",
    { supabaseUrl: "https://supabase.example", supabaseAnonKey: "anon" },
    fetcher,
  );
  assert.deepEqual(verified, {
    id: "user-456",
    email: "renter@example.com",
    name: "Alex Renter",
  });

  await assert.rejects(
    verifyGoogleBookingUser(
      "access-token",
      { supabaseUrl: "https://supabase.example", supabaseAnonKey: "anon" },
      async () => Response.json({
        id: "user-456",
        email: "renter@example.com",
        app_metadata: { provider: "email" },
        user_metadata: { full_name: "Alex Renter" },
      }),
    ),
    (error: unknown) => error instanceof BookingAuthError && error.status === 401,
  );
});

test("sends queued confirmation email and records retry state on delivery failure", async () => {
  const item: EmailOutboxItem = {
    _id: "inquiry-confirmation:41",
    attempts: 1,
    inquiry: {
      id: 41,
      email: "renter@example.com",
      name: "Renter, Alex",
      car_name: "Honda City",
      pickup_date: "2026-11-10",
      pickup_time: "09:00",
      return_date: "2026-11-10",
      quoted_rate: 1000,
    },
  };
  const repository = createRepository();
  let completed = "";
  let retry: { id: string; attempts: number; error: string } | undefined;
  repository.claimInquiryConfirmation = async () => item;
  repository.completeInquiryConfirmation = async (id) => { completed = id; };
  repository.retryInquiryConfirmation = async (id, attempts, error) => {
    retry = { id, attempts, error };
  };
  let message: SendMailOptions | undefined;
  const emailActivities: string[] = [];
  const recordEmailActivity = async (type: string, activity: string) => {
    emailActivities.push(`${type}:${activity}`);
  };
  assert.equal(await runInquiryConfirmationWorker(
    repository,
    async (value) => { message = value; },
    recordEmailActivity,
  ), true);
  assert.equal(message?.to, "renter@example.com");
  assert.match(String(message?.text), /no payment has been taken/i);
  assert.match(String(message?.subject), /We received your carTOGO.mnl inquiry/);
  assert.match(String(message?.html), /Thank you for reaching out/);
  assert.equal(completed, item._id);

  const failure = new Error("temporary SMTP failure");
  assert.equal(await runInquiryConfirmationWorker(
    repository,
    async () => { throw failure; },
    recordEmailActivity,
  ), true);
  assert.deepEqual(retry, {
    id: item._id,
    attempts: item.attempts,
    error: "temporary SMTP failure",
  });
  assert.deepEqual(emailActivities, [
    "inquiry_confirmation:attempted",
    "inquiry_confirmation:sent",
    "inquiry_confirmation:attempted",
    "inquiry_confirmation:failed",
  ]);
});
