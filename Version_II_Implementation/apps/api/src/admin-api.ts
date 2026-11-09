import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { Router, type Request, type RequestHandler, type Response } from "express";
import nodemailer from "nodemailer";
import {
  PublicUnitSchema,
  SiteAssetSchema,
  SiteContentSchema,
} from "@cartogo/contracts";
import type { AuthenticatedAdmin } from "./auth.js";
import { inquiryRejectionEmail, ownerApprovalEmail } from "./email-templates.js";

type ApprovalResource =
  | "unit"
  | "site_assets"
  | "site_content"
  | "admin_accounts"
  | "admin_roles"
  | "chat_sessions";
type ChangeAction = "add" | "update" | "delete" | "remove";

export type ApprovalChallenge = {
  id: string;
  resource: ApprovalResource;
  requester_id: string;
  requester_email: string;
  owner_emails: string[];
  action: ChangeAction;
  data: Record<string, unknown>;
  code_hash: string;
  expires_at: Date;
  created_at: Date;
  attempts: number;
};

export type AdminRole = { email: string; titles: string[] };

export type AdminDataRepository = {
  listUnits(): Promise<unknown[]>;
  listSiteAssets(): Promise<unknown[]>;
  getSiteContent(): Promise<unknown | null>;
  listInquiries(): Promise<unknown[]>;
  listChatSessions(): Promise<unknown[]>;
  getAdminRole(email: string): Promise<AdminRole | null>;
  listAdminRoles(emails: string[]): Promise<AdminRole[]>;
  hasPermission(email: string, permission: string): Promise<boolean>;
  listOwnerEmails(): Promise<string[]>;
  setAdminTitles(email: string, titles: string[]): Promise<unknown>;
  saveApproval(challenge: ApprovalChallenge): Promise<void>;
  getApproval(id: string): Promise<ApprovalChallenge | null>;
  incrementApprovalAttempts(id: string): Promise<number | null>;
  consumeApproval(id: string): Promise<boolean>;
  applyUnitChange(action: ChangeAction, unit: Record<string, unknown>): Promise<unknown>;
  applySiteAssetChange(action: ChangeAction, asset: Record<string, unknown>): Promise<unknown>;
  updateSiteContent(update: Record<string, unknown>): Promise<unknown>;
  updateInquiryStatus(id: number, status: string): Promise<unknown>;
  restoreInquiry(id: number): Promise<unknown>;
  rejectInquiry(id: number, reason: string): Promise<Record<string, unknown>>;
  getInquiry(id: number): Promise<Record<string, unknown> | null>;
  markInquiryRejectionEmailSent(id: number): Promise<unknown>;
  deleteInquiry(id: number): Promise<unknown>;
  removeAdminRole(email: string): Promise<void>;
  deleteChatSession(id: string): Promise<unknown>;
};

type AdminApiConfig = {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  supabaseServiceRoleKey?: string;
  initialOwnerEmail?: string;
  smtpUser?: string;
  smtpPassword?: string;
  smtpHost?: string;
  smtpPort?: string;
  smtpFrom?: string;
  sendEmail?: (to: string, subject: string, text: string, html?: string) => Promise<void>;
};

type ResourcePermission = {
  resource: ApprovalResource;
  permission: string;
  ownerOnly?: boolean;
};

const resourcePermissions: Record<string, ResourcePermission> = {
  unit: { resource: "unit", permission: "fleet" },
  site_assets: { resource: "site_assets", permission: "site_assets" },
  site_content: { resource: "site_content", permission: "site_content" },
  admin_accounts: { resource: "admin_accounts", permission: "admin_accounts", ownerOnly: true },
  admin_roles: { resource: "admin_roles", permission: "admin_accounts", ownerOnly: true },
  chat_sessions: { resource: "chat_sessions", permission: "chat" },
};

const lastApprovalRequest = new Map<string, number>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sendError(response: Response, status: number, message: string): void {
  response.status(status).json({ error: message });
}

function authenticatedAdmin(request: Request): AuthenticatedAdmin {
  if (!request.authenticatedAdmin) throw new Error("Admin authentication middleware was not applied.");
  return request.authenticatedAdmin;
}

function requirePermission(
  getRepository: () => Promise<AdminDataRepository>,
  permission: string,
): RequestHandler {
  return (request, response, next) => {
    void (async () => {
      const admin = authenticatedAdmin(request);
      if (!await (await getRepository()).hasPermission(admin.email, permission)) {
        sendError(response, 403, "Your administrator title does not allow this action.");
        return;
      }
      next();
    })().catch((error: unknown) => {
      console.error("Could not verify administrator permissions.", error instanceof Error ? error.name : "UnknownError");
      sendError(response, 503, "Administrator roles are unavailable.");
    });
  };
}

function requireOwner(
  getRepository: () => Promise<AdminDataRepository>,
): RequestHandler {
  return (request, response, next) => {
    void (async () => {
      const role = await (await getRepository()).getAdminRole(authenticatedAdmin(request).email);
      if (!role?.titles.includes("Owner")) {
        sendError(response, 403, "Only an Owner can approve this change.");
        return;
      }
      next();
    })().catch((error: unknown) => {
      console.error("Could not verify Owner role.", error instanceof Error ? error.name : "UnknownError");
      sendError(response, 503, "Administrator roles are unavailable.");
    });
  };
}

function normalizedEmail(value: unknown): string {
  if (typeof value !== "string") throw new Error("Enter a valid administrator email.");
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error("Enter a valid administrator email.");
  }
  return email;
}

function normalizeUnitChange(action: unknown, data: unknown): [ChangeAction, Record<string, unknown>] {
  if (!["add", "update", "delete"].includes(String(action)) || !isRecord(data)) {
    throw new Error("Choose a valid unit change.");
  }
  const normalizedAction = action as ChangeAction;
  if (normalizedAction === "delete") {
    if (!Number.isSafeInteger(data.id) || Number(data.id) < 1 ||
        typeof data.display_name !== "string" || !data.display_name.trim() ||
        data.display_name.trim().length > 160) {
      throw new Error("A valid unit ID and display name are required for deletion.");
    }
    return [normalizedAction, { id: data.id, display_name: data.display_name.trim() }];
  }
  const unit = PublicUnitSchema.safeParse(
    normalizedAction === "add" ? { ...data, id: 1 } : data,
  );
  if (!unit.success) throw new Error("Provide a complete unit with valid rates, capacity, status, and features.");
  if (normalizedAction === "update" && (!Number.isSafeInteger(unit.data.id) || unit.data.id < 1)) {
    throw new Error("A valid unit ID is required for updates.");
  }
  return [
    normalizedAction,
    {
      ...(normalizedAction === "update" ? { id: unit.data.id } : {}),
      display_name: unit.data.display_name,
      brand: unit.data.brand,
      model: unit.data.model,
      capacity: unit.data.capacity,
      in12_rate: unit.data.in12_rate,
      in24_rate: unit.data.in24_rate,
      out12_rate: unit.data.out12_rate,
      out24_rate: unit.data.out24_rate,
      luzon_rate: unit.data.luzon_rate,
      status: unit.data.status,
      features: unit.data.features,
    },
  ];
}

function normalizeAssetChange(action: unknown, data: unknown): [ChangeAction, Record<string, unknown>] {
  if (!["add", "update", "delete"].includes(String(action)) || !isRecord(data)) {
    throw new Error("Choose a valid site asset change.");
  }
  const normalizedAction = action as ChangeAction;
  if (normalizedAction === "delete") {
    if (data.asset_type !== "location" || !Number.isSafeInteger(data.id) || Number(data.id) < 1) {
      throw new Error("Only a valid pickup location can be deleted.");
    }
    return [normalizedAction, { id: data.id, asset_type: "location" }];
  }
  const asset = SiteAssetSchema.safeParse(
    normalizedAction === "add" ? { ...data, id: 1 } : data,
  );
  if (!asset.success) throw new Error("Provide a complete site asset with valid contact or location details.");
  if (asset.data.asset_type === "contact" && normalizedAction !== "update") {
    throw new Error("The live-agent contact record can only be updated.");
  }
  if (normalizedAction === "update" && (!Number.isSafeInteger(asset.data.id) || asset.data.id < 1)) {
    throw new Error("A valid site asset ID is required for updates.");
  }
  const normalizedAsset: Record<string, unknown> = {
    id: asset.data.id,
    asset_type: asset.data.asset_type,
    display_name: asset.data.display_name,
    description: asset.data.description,
    status: asset.data.status,
  };
  if (asset.data.asset_type === "location") {
    Object.assign(normalizedAsset, {
      loc_name: asset.data.loc_name,
      coordinates: asset.data.coordinates,
      opening_hours: asset.data.opening_hours,
      closing_hours: asset.data.closing_hours,
    });
  } else {
    Object.assign(normalizedAsset, {
      phone: asset.data.phone,
      email: asset.data.email,
      operational_hours: asset.data.operational_hours,
    });
  }
  return [normalizedAction, normalizedAsset];
}

function normalizeSiteContent(data: unknown): Record<string, unknown> {
  const allowedFields = ["settings", "labels", "discountRules", "socialLinks"];
  if (!isRecord(data) || !Object.keys(data).length || Object.keys(data).some((key) => !allowedFields.includes(key))) {
    throw new Error("Only site settings, page labels, discount rules, and social links can be updated.");
  }
  const update: Record<string, unknown> = {};
  const settingsKeys = new Set([
    "companyName", "tagline", "currency", "depositPercent", "extraDriverFee",
    "childSeatFee", "lateFeePerHour",
  ]);
  if ("settings" in data) {
    if (!isRecord(data.settings) || !Object.keys(data.settings).length ||
        Object.keys(data.settings).some((key) => !settingsKeys.has(key))) {
      throw new Error("Settings contain unsupported fields.");
    }
    for (const [key, value] of Object.entries(data.settings)) {
      if (["companyName", "tagline", "currency"].includes(key)) {
        if (typeof value !== "string" || !value.trim() || value.length > 120) {
          throw new Error(`${key} must be a non-empty text value up to 120 characters.`);
        }
      } else if (typeof value !== "number" || !Number.isFinite(value) || value < 0 ||
          (key === "depositPercent" && value > 100)) {
        throw new Error(`${key} must be a valid non-negative number.`);
      }
    }
    update.settings = data.settings;
  }
  if ("labels" in data) {
    if (!isRecord(data.labels) || !Object.keys(data.labels).length ||
        Object.keys(data.labels).some((key) => !["termsAndConditions", "hero", "trustStrip", "howItWorks", "whyChooseUs", "about", "faq", "testimonials"].includes(key))) {
      throw new Error("Labels contain unsupported fields. Contact and pickup details are managed in site assets.");
    }
    if (
      "termsAndConditions" in data.labels &&
      (typeof data.labels.termsAndConditions !== "string" || data.labels.termsAndConditions.length > 50_000)
    ) {
      throw new Error("Terms and Conditions must be text no longer than 50,000 characters.");
    }
    update.labels = data.labels;
  }
  if ("discountRules" in data) {
    if (!Array.isArray(data.discountRules)) {
      throw new Error("Discount rules must be a list.");
    }
    update.discountRules = data.discountRules;
  }
  if ("socialLinks" in data) {
    if (!Array.isArray(data.socialLinks)) {
      throw new Error("Social links must be a list.");
    }
    update.socialLinks = data.socialLinks;
  }
  return update;
}

function normalizeOwnerChange(body: unknown): {
  resource: ResourcePermission;
  action: ChangeAction;
  data: Record<string, unknown>;
} {
  if (!isRecord(body)) throw new Error("Choose a supported owner-approved change.");
  const configuredResource = resourcePermissions[String(body.resource)];
  if (!configuredResource) throw new Error("Choose a supported owner-approved change.");
  const action = body.action;
  const data = body.data;
  if (configuredResource.resource === "unit") {
    const [normalizedAction, normalizedData] = normalizeUnitChange(action, data);
    return { resource: configuredResource, action: normalizedAction, data: normalizedData };
  }
  if (configuredResource.resource === "site_assets") {
    const [normalizedAction, normalizedData] = normalizeAssetChange(action, data);
    return { resource: configuredResource, action: normalizedAction, data: normalizedData };
  }
  if (configuredResource.resource === "site_content") {
    if (action !== "update") throw new Error("Choose valid site content changes.");
    return { resource: configuredResource, action, data: normalizeSiteContent(data) };
  }
  if (configuredResource.resource === "admin_roles") {
    if (action !== "update" || !isRecord(data) || !Array.isArray(data.titles) ||
        !data.titles.length || data.titles.some((title) => title !== "Owner" && title !== "Moderator")) {
      throw new Error("Choose a valid administrator-title change.");
    }
    return {
      resource: configuredResource,
      action,
      data: { email: normalizedEmail(data.email), titles: [...new Set(data.titles)] },
    };
  }
  if (configuredResource.resource === "admin_accounts") {
    if ((action !== "add" && action !== "remove") || !isRecord(data)) {
      throw new Error("Choose a valid administrator account change.");
    }
    return { resource: configuredResource, action, data: { email: normalizedEmail(data.email) } };
  }
  if (configuredResource.resource === "chat_sessions") {
    if (action !== "delete" || !isRecord(data) || typeof data.id !== "string" ||
        !data.id || data.id.length > 200) {
      throw new Error("Choose a valid chat-session change.");
    }
    return { resource: configuredResource, action, data: { id: data.id } };
  }
  throw new Error("Choose a supported owner-approved change.");
}

async function sendMail(config: AdminApiConfig, to: string, subject: string, text: string, html?: string): Promise<void> {
  const user = config.smtpUser?.trim();
  const password = config.smtpPassword?.trim().replace(/\s+/g, "");
  if (!user || !password) throw new Error("SMTP is not configured on the API.");
  const port = Number(config.smtpPort || 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("SMTP_PORT must be a valid port.");
  const transport = nodemailer.createTransport({
    host: config.smtpHost?.trim() || "smtp.gmail.com",
    port,
    secure: port === 465,
    auth: { user, pass: password },
    disableFileAccess: true,
    disableUrlAccess: true,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
  });
  await transport.sendMail({
    from: config.smtpFrom?.trim() || user,
    to,
    subject,
    text,
    html,
  });
}

async function getAllowlistedAdminEmails(
  config: AdminApiConfig,
  request: Request,
): Promise<string[]> {
  const baseUrl = config.supabaseUrl?.trim().replace(/\/+$/, "");
  const anonKey = config.supabaseAnonKey?.trim();
  const token = request.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!baseUrl || !anonKey || !token) throw new Error("Supabase administrator list is unavailable.");
  const response = await fetch(`${baseUrl}/rest/v1/rpc/get_cartogo_admin_emails`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: "{}",
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error("Supabase administrator list is unavailable.");
  const emails: unknown = await response.json();
  if (!Array.isArray(emails) || emails.some((email) => typeof email !== "string")) {
    throw new Error("Supabase returned an invalid administrator list.");
  }
  return [...new Set(emails.map((email) => email.trim().toLowerCase()))];
}

async function changeSupabaseAdminAccount(
  config: AdminApiConfig,
  action: ChangeAction,
  email: string,
): Promise<void> {
  const baseUrl = config.supabaseUrl?.trim().replace(/\/+$/, "");
  const serviceKey = config.supabaseServiceRoleKey?.trim();
  if (!baseUrl || !serviceKey) throw new Error("Supabase admin-account management is not configured on the API.");
  const rpc = action === "add" ? "add_cartogo_admin_email" : "remove_cartogo_admin_email";
  const response = await fetch(`${baseUrl}/rest/v1/rpc/${rpc}`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_email: email }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error("Supabase could not apply the administrator-account change.");
}

async function applyApprovedChange(
  repository: AdminDataRepository,
  config: AdminApiConfig,
  challenge: ApprovalChallenge,
): Promise<unknown> {
  const { resource, action, data } = challenge;
  if (resource === "unit") return repository.applyUnitChange(action, data);
  if (resource === "site_assets") return repository.applySiteAssetChange(action, data);
  if (resource === "site_content") return repository.updateSiteContent(data as Record<string, Record<string, unknown>>);
  if (resource === "admin_roles") {
    return repository.setAdminTitles(String(data.email), data.titles as string[]);
  }
  if (resource === "admin_accounts") {
    const email = String(data.email);
    const currentOwners = await repository.listOwnerEmails();
    if (action === "remove" && currentOwners.length === 1 && currentOwners[0] === email) {
      throw new Error("At least one Owner account must remain.");
    }
    await changeSupabaseAdminAccount(config, action, email);
    if (action === "add") {
      const titles = config.initialOwnerEmail?.trim().toLowerCase() === email ? ["Owner"] : ["Moderator"];
      await repository.getAdminRole(email);
      if (titles.includes("Owner")) await repository.setAdminTitles(email, titles);
    } else {
      await repository.removeAdminRole(email);
    }
    return { email };
  }
  if (resource === "chat_sessions") {
    return repository.deleteChatSession(String(data.id));
  }
  throw new Error("Choose a supported owner-approved change.");
}

export function createAdminRouter(
  getRepository: () => Promise<AdminDataRepository>,
  config: AdminApiConfig,
): Router {
  const router = Router();

  router.get("/me", async (request, response) => {
    try {
      const admin = authenticatedAdmin(request);
      const role = await (await getRepository()).getAdminRole(admin.email);
      response.json({ email: admin.email, titles: role?.titles ?? [] });
    } catch (error) {
      console.error("Could not read administrator identity.", error instanceof Error ? error.name : "UnknownError");
      sendError(response, 503, "MongoDB administrator roles are unavailable.");
    }
  });

  router.get("/roles", requireOwner(getRepository), async (request, response) => {
    try {
      const emails = await getAllowlistedAdminEmails(config, request);
      const roles = await (await getRepository()).listAdminRoles(emails);
      response.json(roles);
    } catch (error) {
      console.error("Could not read administrator roles.", error instanceof Error ? error.name : "UnknownError");
      sendError(response, 503, "Administrator roles are unavailable.");
    }
  });

  router.get("/units", requirePermission(getRepository, "fleet"), async (_request, response) => {
    try {
      response.json(await (await getRepository()).listUnits());
    } catch (error) {
      console.error("Could not read admin fleet.", error instanceof Error ? error.name : "UnknownError");
      sendError(response, 503, "MongoDB fleet data is unavailable.");
    }
  });

  router.get("/site-assets", requirePermission(getRepository, "site_assets"), async (_request, response) => {
    try {
      response.json(await (await getRepository()).listSiteAssets());
    } catch (error) {
      console.error("Could not read admin site assets.", error instanceof Error ? error.name : "UnknownError");
      sendError(response, 503, "MongoDB site assets are unavailable.");
    }
  });

  router.get("/site-content", requirePermission(getRepository, "site_content"), async (_request, response) => {
    try {
      const content = await (await getRepository()).getSiteContent();
      const validated = SiteContentSchema.safeParse(content);
      if (!validated.success) {
        sendError(response, 503, "MongoDB site content is unavailable.");
        return;
      }
      response.json(validated.data);
    } catch (error) {
      console.error("Could not read admin site content.", error instanceof Error ? error.name : "UnknownError");
      sendError(response, 503, "MongoDB site content is unavailable.");
    }
  });

  router.get("/inquiries", requirePermission(getRepository, "inquiries"), async (_request, response) => {
    try {
      response.json(await (await getRepository()).listInquiries());
    } catch (error) {
      console.error("Could not read inquiries.", error instanceof Error ? error.name : "UnknownError");
      sendError(response, 503, "MongoDB inquiries are unavailable.");
    }
  });

  router.get("/chat-sessions", requirePermission(getRepository, "chat"), async (_request, response) => {
    try {
      response.json(await (await getRepository()).listChatSessions());
    } catch (error) {
      console.error("Could not read chat sessions.", error instanceof Error ? error.name : "UnknownError");
      sendError(response, 503, "MongoDB chat sessions are unavailable.");
    }
  });

  router.post("/inquiries", requirePermission(getRepository, "inquiries"), async (request, response) => {
    if (!isRecord(request.body)) {
      sendError(response, 400, "Provide an inquiry action.");
      return;
    }
    const id = Number(request.body.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      sendError(response, 400, "A valid inquiry ID is required.");
      return;
    }
    try {
      const repository = await getRepository();
      const action = request.body.action;
      if (action === "update") {
        if (request.body.status !== "confirmed") throw new Error("Choose a valid inquiry status.");
        response.json({ data: await repository.updateInquiryStatus(id, "confirmed") });
      } else if (action === "restore") {
        response.json({ data: await repository.restoreInquiry(id) });
      } else if (action === "reject" || action === "resend_rejection") {
        const existing = await repository.getInquiry(id);
        if (!existing) throw new Error("That inquiry no longer exists.");

        const retryingRejection = existing.status === "rejected";
        const alreadyEmailed = retryingRejection && existing.rejection_email_sent === true;
        const savedReason = typeof existing.rejection_reason === "string" ? existing.rejection_reason : "";
        const suppliedReason = typeof request.body.reason === "string" ? request.body.reason.trim() : "";
        const reason = retryingRejection && savedReason ? savedReason : suppliedReason;
        if (!alreadyEmailed && (!reason || reason.length > 3000 || reason.split(/\s+/).length > 250)) {
          throw new Error("Enter a rejection reason of no more than 250 words.");
        }

        const inquiry = retryingRejection || alreadyEmailed
          ? existing
          : await repository.rejectInquiry(id, reason);
        if (inquiry.rejection_email_sent !== true) {
          const to = typeof inquiry.email === "string" ? inquiry.email : "";
          if (!to) throw new Error("Inquiry email address is missing.");
          try {
            const subject = "An update about your carTOGO.mnl inquiry";
            const message = inquiryRejectionEmail(
              String(inquiry.firstName || inquiry.name || "there"),
              reason,
            );
            if (config.sendEmail) await config.sendEmail(to, subject, message.text, message.html);
            else await sendMail(config, to, subject, message.text, message.html);
          } catch (emailError) {
            console.error("Inquiry rejection email could not be sent.", emailError instanceof Error ? emailError.name : "UnknownError");
            throw new Error("The rejection email could not be sent. The inquiry was kept; retry to send the email and complete deletion.");
          }
          await repository.markInquiryRejectionEmailSent(id);
        }
        const deleted = await repository.deleteInquiry(id);
        response.json({ data: deleted, emailSent: true, deleted: true });
      } else {
        throw new Error("Choose a valid inquiry action.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "MongoDB could not apply the inquiry change.";
      const status = /valid|enter|choose|only|already|reason|email address/i.test(message) ? 400 :
        /no longer exists/i.test(message) ? 404 : 503;
      if (status === 503) console.error("Inquiry action failed.", error instanceof Error ? error.name : "UnknownError");
      sendError(response, status, message);
    }
  });

  router.post("/owner-change/request", async (request, response) => {
    let change: ReturnType<typeof normalizeOwnerChange>;
    let approvalRateKey: string | undefined;
    let approvalRateTimestamp: number | undefined;
    try {
      change = normalizeOwnerChange(request.body);
    } catch (error) {
      sendError(response, 400, error instanceof Error ? error.message : "Choose a valid owner-approved change.");
      return;
    }
    try {
      const admin = authenticatedAdmin(request);
      const repository = await getRepository();
      if (change.resource.ownerOnly) {
        const role = await repository.getAdminRole(admin.email);
        if (!role?.titles.includes("Owner")) {
          sendError(response, 403, "Only an Owner can manage administrator accounts and titles.");
          return;
        }
      }
      if (!await repository.hasPermission(admin.email, change.resource.permission)) {
        sendError(response, 403, "Your administrator title does not allow this action.");
        return;
      }
      if (change.resource.resource === "site_content") {
        const current = await repository.getSiteContent();
        if (!isRecord(current) || !isRecord(current.settings) || !isRecord(current.labels)) {
          sendError(response, 503, "Site content is not initialized.");
          return;
        }
        const updated = SiteContentSchema.safeParse({
          ...current,
          ...(change.data.settings
            ? { settings: { ...current.settings, ...change.data.settings } }
            : {}),
          ...(change.data.labels
            ? { labels: { ...current.labels, ...change.data.labels } }
            : {}),
        });
        if (!updated.success) {
          sendError(response, 400, "The requested site content does not match the public content contract.");
          return;
        }
      }
      const ownerEmails = await repository.listOwnerEmails();
      if (!ownerEmails.length) throw new Error("No Owner title is assigned to an administrator in MongoDB.");
      const now = Date.now();
      const rateKey = ownerEmails.join(",");
      const lastRequest = lastApprovalRequest.get(rateKey) ?? 0;
      if (now - lastRequest < 15_000) {
        sendError(response, 429, "Wait 15 seconds before requesting another owner approval PIN.");
        return;
      }
      if (!config.smtpUser?.trim() || !config.smtpPassword?.trim()) {
        sendError(response, 503, "Configure SMTP credentials in apps/api/.env before requesting owner approval.");
        return;
      }
      lastApprovalRequest.set(rateKey, now);
      approvalRateKey = rateKey;
      approvalRateTimestamp = now;
      const id = randomBytes(24).toString("base64url");
      const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
      const expiresAt = new Date(now + 5 * 60_000);
      const approval: ApprovalChallenge = {
        id,
        resource: change.resource.resource,
        requester_id: admin.id,
        requester_email: admin.email,
        owner_emails: ownerEmails,
        action: change.action,
        data: change.data,
        code_hash: createHash("sha256").update(`${id}:${code}`).digest("hex"),
        expires_at: expiresAt,
        created_at: new Date(now),
        attempts: 0,
      };
      await repository.saveApproval(approval);
      const operation = { add: "Add", update: "Update", delete: "Delete", remove: "Remove" }[change.action];
      const subjectResource = change.resource.resource.replaceAll("_", " ");
      try {
        for (const email of ownerEmails) {
          const message = ownerApprovalEmail({
            operation,
            resource: subjectResource,
            requester: admin.email,
            data: change.data,
            code,
          });
          await sendMail(
            config,
            email,
            `Approval needed: ${operation} ${subjectResource} | carTOGO.mnl`,
            message.text,
            message.html,
          );
        }
      } catch (error) {
        await repository.consumeApproval(id);
        lastApprovalRequest.delete(rateKey);
        console.error("Owner approval PIN delivery failed.", error instanceof Error ? error.name : "UnknownError");
        sendError(response, 503, "SMTP could not send the owner approval PIN. Check the API SMTP settings.");
        return;
      }
      response.json({ challengeId: id, ownerEmail: ownerEmails.join(", "), expiresIn: 300 });
    } catch (error) {
      if (
        approvalRateKey &&
        approvalRateTimestamp !== undefined &&
        lastApprovalRequest.get(approvalRateKey) === approvalRateTimestamp
      ) {
        lastApprovalRequest.delete(approvalRateKey);
      }
      console.error("Could not create owner approval request.", error instanceof Error ? error.name : "UnknownError");
      sendError(response, 503, "Owner approval is unavailable.");
    }
  });

  router.post("/owner-change/approve", requireOwner(getRepository), async (request, response) => {
    if (!isRecord(request.body) || typeof request.body.challengeId !== "string" ||
        typeof request.body.code !== "string" || !/^\d{6}$/.test(request.body.code)) {
      sendError(response, 400, "Enter the six-digit approval code.");
      return;
    }
    const admin = authenticatedAdmin(request);
    try {
      const repository = await getRepository();
      const challenge = await repository.getApproval(request.body.challengeId);
      if (!challenge || challenge.expires_at.getTime() < Date.now()) {
        if (challenge) await repository.consumeApproval(challenge.id);
        sendError(response, 403, "That approval code expired. Request a new one.");
        return;
      }
      if (!challenge.owner_emails.includes(admin.email)) {
        await repository.consumeApproval(challenge.id);
        sendError(response, 403, "This PIN was not issued to your Owner account.");
        return;
      }
      const attempts = await repository.incrementApprovalAttempts(challenge.id);
      if (attempts === null) {
        sendError(response, 403, "That approval code expired. Request a new one.");
        return;
      }
      const providedHash = createHash("sha256").update(`${challenge.id}:${request.body.code}`).digest();
      const expectedHash = Buffer.from(challenge.code_hash, "hex");
      const valid = expectedHash.length === providedHash.length && timingSafeEqual(expectedHash, providedHash);
      if (!valid || attempts > 5) {
        if (attempts >= 5) await repository.consumeApproval(challenge.id);
        sendError(response, 403, "The approval code is invalid or has expired.");
        return;
      }
      if (!await repository.consumeApproval(challenge.id)) {
        sendError(response, 403, "That approval code has already been used.");
        return;
      }
      const result = await applyApprovedChange(repository, config, challenge);
      response.json({ data: result, resource: challenge.resource });
    } catch (error) {
      console.error("Owner-approved change failed.", error instanceof Error ? error.name : "UnknownError");
      const message = error instanceof Error ? error.message : "MongoDB could not apply the owner-approved change.";
      const status = /at least one Owner|no longer exists|not found|does not match|must remain/i.test(message) ? 400 : 503;
      sendError(response, status, message);
    }
  });

  return router;
}
