import dotenv from "dotenv";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import { fileURLToPath } from "node:url";
import { ApiHealthSchema, ApiReadinessSchema } from "@cartogo/contracts";
import type { AdminDataRepository } from "./admin-api.js";
import type { BookingRepository } from "./booking.js";
import type { PublicDataRepository } from "./public-data.js";
import { createAuthRouter, createRequireAdmin } from "./auth.js";
import { createAdminRouter } from "./admin-api.js";
import { createAdminActivityLogger } from "./admin-activity.js";
import { createSupabaseFleetRepository } from "./supabase-fleet.js";
import { createSupabaseSiteAssetRepository } from "./supabase-site-assets.js";
import { createSupabaseSiteContentRepository } from "./supabase-site-content.js";
import { createSupabaseEmailActivityRepository } from "./supabase-email-activity.js";
import { createSupabaseAdminRolesRepository } from "./supabase-admin-roles.js";
import { createSupabaseOwnerApprovalsRepository } from "./supabase-owner-approvals.js";
import { createSupabaseChatSessionsRepository } from "./supabase-chat-sessions.js";
import { createSupabaseInquiriesRepository } from "./supabase-inquiries.js";
import { createSupabaseEmailOutboxRepository } from "./supabase-email-outbox.js";
import { createSupabaseGuestChallengesRepository } from "./supabase-guest-challenges.js";
import { createPublicDataRouter } from "./public-data.js";
import { createChatbotRouter } from "./chatbot.js";
import {
  createBookingMailer,
  createBookingRouter,
  runInquiryConfirmationWorker,
  verifyGoogleBookingUser,
} from "./booking.js";

dotenv.config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

const app = express();
const port = Number(process.env.API_PORT ?? 3001);
const supabaseFleetRepository = createSupabaseFleetRepository({
  supabaseUrl: process.env.SUPABASE_URL,
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
});
const supabaseSiteAssetRepository = createSupabaseSiteAssetRepository({
  supabaseUrl: process.env.SUPABASE_URL,
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
});
const supabaseSiteContentRepository = createSupabaseSiteContentRepository({
  supabaseUrl: process.env.SUPABASE_URL,
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
});
const supabaseEmailActivityRepository = createSupabaseEmailActivityRepository({
  supabaseUrl: process.env.SUPABASE_URL,
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
});
const supabaseAdminRolesRepository = createSupabaseAdminRolesRepository({
  supabaseUrl: process.env.SUPABASE_URL,
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  initialOwnerEmail: process.env.CARTOGO_INITIAL_OWNER_EMAIL,
});
const supabaseOwnerApprovalsRepository = createSupabaseOwnerApprovalsRepository({
  supabaseUrl: process.env.SUPABASE_URL,
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
});
const supabaseChatSessionsRepository = createSupabaseChatSessionsRepository({
  supabaseUrl: process.env.SUPABASE_URL,
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
});
const supabaseInquiriesRepository = createSupabaseInquiriesRepository({
  supabaseUrl: process.env.SUPABASE_URL,
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
});
const recordStoredEmailActivity = supabaseEmailActivityRepository.recordEmailActivity;
const supabaseEmailOutboxRepository = createSupabaseEmailOutboxRepository({
  supabaseUrl: process.env.SUPABASE_URL,
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  recordEmailActivity: recordStoredEmailActivity,
});
const supabaseGuestChallengesRepository = createSupabaseGuestChallengesRepository({
  supabaseUrl: process.env.SUPABASE_URL,
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
});
const getAdminRepository = async (): Promise<AdminDataRepository> => ({
  listUnits: supabaseFleetRepository.listUnits,
  listSiteAssets: supabaseSiteAssetRepository.listSiteAssets,
  getSiteContent: supabaseSiteContentRepository.getSiteContent,
  listInquiries: supabaseInquiriesRepository.listInquiries,
  listEmailActivities: supabaseEmailActivityRepository.listEmailActivities,
  listVehicleDemand: supabaseInquiriesRepository.listVehicleDemand,
  listChatSessions: supabaseChatSessionsRepository.listChatSessions,
  getAdminRole: supabaseAdminRolesRepository.getAdminRole,
  hasPermission: supabaseAdminRolesRepository.hasPermission,
  listOwnerEmails: supabaseAdminRolesRepository.listOwnerEmails,
  saveApproval: supabaseOwnerApprovalsRepository.saveApproval,
  getApproval: supabaseOwnerApprovalsRepository.getApproval,
  incrementApprovalAttempts: supabaseOwnerApprovalsRepository.incrementApprovalAttempts,
  consumeApproval: supabaseOwnerApprovalsRepository.consumeApproval,
  applyUnitChange: supabaseFleetRepository.applyUnitChange,
  applySiteAssetChange: supabaseSiteAssetRepository.applySiteAssetChange,
  updateSiteContent: supabaseSiteContentRepository.updateSiteContent,
  updateInquiryStatus: supabaseInquiriesRepository.updateInquiryStatus,
  restoreInquiry: supabaseInquiriesRepository.restoreInquiry,
  rejectInquiry: supabaseInquiriesRepository.rejectInquiry,
  getInquiry: supabaseInquiriesRepository.getInquiry,
  markInquiryRejectionEmailSent: supabaseInquiriesRepository.markInquiryRejectionEmailSent,
  deleteInquiry: supabaseInquiriesRepository.deleteInquiry,
  deleteChatSession: supabaseChatSessionsRepository.deleteChatSession,
});
const getBookingRepositoryForStorage = async (): Promise<BookingRepository> => ({
  getUnit: supabaseFleetRepository.getUnit,
  getBookingPricing: supabaseSiteContentRepository.getBookingPricing,
  findInquiryByRequestId: supabaseInquiriesRepository.findInquiryByRequestId,
  createGuestChallenge: supabaseGuestChallengesRepository.createGuestChallenge,
  getGuestChallenge: supabaseGuestChallengesRepository.getGuestChallenge,
  incrementGuestChallengeAttempts: supabaseGuestChallengesRepository.incrementGuestChallengeAttempts,
  saveGuestChallengeVerification: supabaseGuestChallengesRepository.saveGuestChallengeVerification,
  deleteGuestChallenge: supabaseGuestChallengesRepository.deleteGuestChallenge,
  consumeGuestChallenge: supabaseGuestChallengesRepository.consumeGuestChallenge,
  releaseGuestChallenge: supabaseGuestChallengesRepository.releaseGuestChallenge,
  addInquiry: supabaseInquiriesRepository.addInquiry,
  enqueueInquiryConfirmation: supabaseEmailOutboxRepository.enqueueInquiryConfirmation,
  claimInquiryConfirmation: supabaseEmailOutboxRepository.claimInquiryConfirmation,
  completeInquiryConfirmation: supabaseEmailOutboxRepository.completeInquiryConfirmation,
  retryInquiryConfirmation: supabaseEmailOutboxRepository.retryInquiryConfirmation,
});
const getPublicDataRepository = async (): Promise<PublicDataRepository> => ({
  listPublicUnits: supabaseFleetRepository.listPublicUnits,
  listSiteAssets: supabaseSiteAssetRepository.listSiteAssets,
  getSiteContent: supabaseSiteContentRepository.getSiteContent,
});
const supabaseAuthConfig = {
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
};
const bookingEmailConfig = {
  smtpUser: process.env.SMTP_USER,
  smtpPassword: process.env.SMTP_APP_PASSWORD,
  smtpHost: process.env.SMTP_HOST,
  smtpPort: process.env.SMTP_PORT,
  smtpFrom: process.env.BOOKING_SMTP_FROM || process.env.SMTP_FROM,
  verificationSecret: process.env.GUEST_EMAIL_VERIFICATION_SECRET
    || process.env.SMTP_APP_PASSWORD,
};
const bookingConfig = {
  ...bookingEmailConfig,
  supabaseUrl: supabaseAuthConfig.supabaseUrl,
  supabaseAnonKey: supabaseAuthConfig.supabaseAnonKey,
  recordEmailActivity: recordStoredEmailActivity,
  verifyGoogleUser: (accessToken: string) =>
    verifyGoogleBookingUser(accessToken, supabaseAuthConfig),
};

async function checkSupabaseReady(): Promise<void> {
  const supabaseUrl = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase server configuration is missing.");
  }

  const response = await fetch(
    `${supabaseUrl}/rest/v1/fleet_documents?select=id&limit=1`,
    {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      signal: AbortSignal.timeout(8_000),
    },
  );
  if (!response.ok) {
    throw new Error(`Supabase readiness request failed with status ${response.status}.`);
  }
}
const sendBookingMail = createBookingMailer(bookingEmailConfig);

app.disable("x-powered-by");
app.use("/api/chatbot", express.json({ limit: "48kb" }));
app.use(express.json({ limit: "16kb" }));
app.use("/api/admin", createRequireAdmin(supabaseAuthConfig));
app.use("/api", createAuthRouter(supabaseAuthConfig));
app.use("/api/admin", createAdminRouter(getAdminRepository, {
  smtpUser: process.env.SMTP_USER,
  smtpPassword: process.env.SMTP_APP_PASSWORD,
  smtpHost: process.env.SMTP_HOST,
  smtpPort: process.env.SMTP_PORT,
  smtpFrom: process.env.SMTP_FROM,
  recordEmailActivity: recordStoredEmailActivity,
  recordAdminActivity: createAdminActivityLogger({
    supabaseUrl: process.env.SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  }),
}));
app.use(
  "/api",
  createPublicDataRouter(
    getPublicDataRepository,
  ),
);
app.use("/api", createBookingRouter(getBookingRepositoryForStorage, bookingConfig));
app.use("/api", createChatbotRouter({ baseUrl: process.env.CHATBOT_URL }));

app.get("/api/health", (_request, response) => {
  response.json(
    ApiHealthSchema.parse({
      status: "ok",
      service: "cartogo-version-ii-api",
    }),
  );
});

app.get("/api/health/ready", async (_request, response) => {
  try {
    await checkSupabaseReady();
    response.json(
      ApiReadinessSchema.parse({
        status: "ready",
        dependencies: { supabase: "ok" },
      }),
    );
  } catch (error) {
    console.error(
      "Supabase readiness check failed.",
      error instanceof Error ? error.name : "UnknownError",
    );
    response.status(503).json(
      ApiReadinessSchema.parse({
        status: "not_ready",
        dependencies: { supabase: "unavailable" },
      }),
    );
  }
});

app.use((error: unknown, _request: Request, response: Response, next: NextFunction) => {
  if (
    typeof error === "object" &&
    error !== null &&
    "type" in error &&
    error.type === "entity.too.large"
  ) {
    response.status(413).json({ error: "Request body is too large." });
    return;
  }
  next(error);
});

const server = app.listen(port, "127.0.0.1", () => {
  console.log(`Version II API listening at http://127.0.0.1:${port}`);
});

let emailWorkerRunning = false;
let emailWorkerTask = Promise.resolve();
const emailWorkerTimer = setInterval(() => {
  if (
    emailWorkerRunning ||
    !process.env.SMTP_USER?.trim() ||
    !process.env.SMTP_APP_PASSWORD?.trim()
  ) return;
  emailWorkerRunning = true;
  emailWorkerTask = (async () => {
    let stage = "opening Supabase booking repository";
    try {
      const repository = await getBookingRepositoryForStorage();
      stage = "claiming or updating the confirmation-email outbox";
      await runInquiryConfirmationWorker(repository, sendBookingMail, recordStoredEmailActivity);
    } catch (error) {
      const details: Record<string, string | number> = {
        stage,
        name: error instanceof Error ? error.name : "UnknownError",
      };
      if (typeof error === "object" && error !== null) {
        if ("code" in error && typeof error.code === "number") details.code = error.code;
        if ("codeName" in error && typeof error.codeName === "string") {
          details.codeName = error.codeName;
        }
      }
      if (error instanceof Error) {
        details.message = error.message.replace(/dup key:.*$/i, "dup key: [redacted]").slice(0, 500);
      }
      console.error("Inquiry confirmation worker failed.", details);
    } finally {
      emailWorkerRunning = false;
    }
  })();
  void emailWorkerTask;
}, 5000);
emailWorkerTimer.unref();

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(`API port ${port} is already in use. Set API_PORT to another port.`);
    process.exitCode = 1;
    return;
  }
  throw error;
});

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  console.log(`Received ${signal}; shutting down Version II API.`);
  clearInterval(emailWorkerTimer);
  server.close(async (error) => {
    if (error) {
      console.error("Failed to close the HTTP server cleanly.", error);
      process.exitCode = 1;
    }
    try {
      await emailWorkerTask;
    } catch (closeError) {
      console.error("The inquiry confirmation worker did not stop cleanly.", closeError);
      process.exitCode = 1;
    }
  });
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
