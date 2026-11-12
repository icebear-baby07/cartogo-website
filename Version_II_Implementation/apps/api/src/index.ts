import dotenv from "dotenv";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import { fileURLToPath } from "node:url";
import { ApiHealthSchema, ApiReadinessSchema } from "@cartogo/contracts";
import {
  checkMongoReady,
  closeMongo,
  connectToMongo,
  getBookingRepository,
  getAdminDataRepository,
  getPublicDataRepository,
  recordEmailActivity,
} from "./mongo.js";
import { createAuthRouter, createRequireAdmin } from "./auth.js";
import { createAdminRouter } from "./admin-api.js";
import { createAdminActivityLogger } from "./admin-activity.js";
import {
  createSupabaseFleetRepository,
  withSupabaseFleetForAdmin,
} from "./supabase-fleet.js";
import {
  createSupabaseSiteAssetRepository,
  withSupabaseSiteAssetsForAdmin,
} from "./supabase-site-assets.js";
import {
  createSupabaseSiteContentRepository,
  withSupabaseSiteContentForAdmin,
  withSupabaseSiteContentForBooking,
} from "./supabase-site-content.js";
import {
  createSupabaseEmailActivityRepository,
  withSupabaseEmailActivitiesForAdmin,
} from "./supabase-email-activity.js";
import {
  createSupabaseAdminRolesRepository,
  withSupabaseAdminRolesForAdmin,
} from "./supabase-admin-roles.js";
import {
  createSupabaseOwnerApprovalsRepository,
  withSupabaseOwnerApprovalsForAdmin,
} from "./supabase-owner-approvals.js";
import {
  createSupabaseChatSessionsRepository,
  withSupabaseChatSessionsForAdmin,
} from "./supabase-chat-sessions.js";
import {
  createSupabaseInquiriesRepository,
  withSupabaseInquiriesForAdmin,
  withSupabaseInquiriesForBooking,
} from "./supabase-inquiries.js";
import {
  createSupabaseEmailOutboxRepository,
  withSupabaseEmailOutboxForBooking,
} from "./supabase-email-outbox.js";
import {
  createSupabaseGuestChallengesRepository,
  withSupabaseGuestChallengesForBooking,
} from "./supabase-guest-challenges.js";
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
const fleetStorage = process.env.FLEET_STORAGE?.trim().toLowerCase() || "mongodb";
if (fleetStorage !== "mongodb" && fleetStorage !== "supabase") {
  throw new Error("FLEET_STORAGE must be either mongodb or supabase.");
}
const siteAssetsStorage = process.env.SITE_ASSETS_STORAGE?.trim().toLowerCase() || "mongodb";
if (siteAssetsStorage !== "mongodb" && siteAssetsStorage !== "supabase") {
  throw new Error("SITE_ASSETS_STORAGE must be either mongodb or supabase.");
}
const siteContentStorage = process.env.SITE_CONTENT_STORAGE?.trim().toLowerCase() || "mongodb";
if (siteContentStorage !== "mongodb" && siteContentStorage !== "supabase") {
  throw new Error("SITE_CONTENT_STORAGE must be either mongodb or supabase.");
}
const emailActivityStorage = process.env.EMAIL_ACTIVITY_STORAGE?.trim().toLowerCase() || "mongodb";
if (emailActivityStorage !== "mongodb" && emailActivityStorage !== "supabase") {
  throw new Error("EMAIL_ACTIVITY_STORAGE must be either mongodb or supabase.");
}
const inquiryStorage = process.env.INQUIRY_STORAGE?.trim().toLowerCase() || "mongodb";
if (inquiryStorage !== "mongodb" && inquiryStorage !== "supabase") {
  throw new Error("INQUIRY_STORAGE must be either mongodb or supabase.");
}
const emailOutboxStorage = process.env.EMAIL_OUTBOX_STORAGE?.trim().toLowerCase() || "mongodb";
if (emailOutboxStorage !== "mongodb" && emailOutboxStorage !== "supabase") {
  throw new Error("EMAIL_OUTBOX_STORAGE must be either mongodb or supabase.");
}
const guestChallengeStorage = process.env.GUEST_CHALLENGE_STORAGE?.trim().toLowerCase() || "mongodb";
if (guestChallengeStorage !== "mongodb" && guestChallengeStorage !== "supabase") {
  throw new Error("GUEST_CHALLENGE_STORAGE must be either mongodb or supabase.");
}
const adminRoleStorage = process.env.ADMIN_ROLE_STORAGE?.trim().toLowerCase() || "mongodb";
if (adminRoleStorage !== "mongodb" && adminRoleStorage !== "supabase") {
  throw new Error("ADMIN_ROLE_STORAGE must be either mongodb or supabase.");
}
const ownerApprovalStorage = process.env.OWNER_APPROVAL_STORAGE?.trim().toLowerCase() || "mongodb";
if (ownerApprovalStorage !== "mongodb" && ownerApprovalStorage !== "supabase") {
  throw new Error("OWNER_APPROVAL_STORAGE must be either mongodb or supabase.");
}
const chatSessionStorage = process.env.CHAT_SESSION_STORAGE?.trim().toLowerCase() || "mongodb";
if (chatSessionStorage !== "mongodb" && chatSessionStorage !== "supabase") {
  throw new Error("CHAT_SESSION_STORAGE must be either mongodb or supabase.");
}
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
const recordStoredEmailActivity = emailActivityStorage === "supabase"
  ? supabaseEmailActivityRepository.recordEmailActivity
  : recordEmailActivity;
const supabaseEmailOutboxRepository = createSupabaseEmailOutboxRepository({
  supabaseUrl: process.env.SUPABASE_URL,
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  recordEmailActivity: recordStoredEmailActivity,
});
const supabaseGuestChallengesRepository = createSupabaseGuestChallengesRepository({
  supabaseUrl: process.env.SUPABASE_URL,
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
});
const getAdminRepository = async () => {
  let repository = await getAdminDataRepository();
  if (ownerApprovalStorage === "supabase") {
    repository = withSupabaseOwnerApprovalsForAdmin(repository, supabaseOwnerApprovalsRepository);
  }
  if (chatSessionStorage === "supabase") {
    repository = withSupabaseChatSessionsForAdmin(repository, supabaseChatSessionsRepository);
  }
  if (adminRoleStorage === "supabase") {
    repository = withSupabaseAdminRolesForAdmin(repository, supabaseAdminRolesRepository);
  }
  if (fleetStorage === "supabase") {
    repository = withSupabaseFleetForAdmin(repository, supabaseFleetRepository);
  }
  if (siteAssetsStorage === "supabase") {
    repository = withSupabaseSiteAssetsForAdmin(repository, supabaseSiteAssetRepository);
  }
  if (emailActivityStorage === "supabase") {
    repository = withSupabaseEmailActivitiesForAdmin(repository, supabaseEmailActivityRepository);
  }
  if (inquiryStorage === "supabase") {
    repository = withSupabaseInquiriesForAdmin(repository, supabaseInquiriesRepository);
  }
  return siteContentStorage === "supabase"
    ? withSupabaseSiteContentForAdmin(repository, supabaseSiteContentRepository)
    : repository;
};
const getBookingRepositoryForStorage = async () => {
  let repository = await getBookingRepository();
  if (inquiryStorage === "supabase") {
    repository = withSupabaseInquiriesForBooking(repository, supabaseInquiriesRepository);
  }
  if (emailOutboxStorage === "supabase") {
    repository = withSupabaseEmailOutboxForBooking(repository, supabaseEmailOutboxRepository);
  }
  if (guestChallengeStorage === "supabase") {
    repository = withSupabaseGuestChallengesForBooking(repository, supabaseGuestChallengesRepository);
  }
  return siteContentStorage === "supabase"
    ? withSupabaseSiteContentForBooking(repository, supabaseSiteContentRepository)
    : repository;
};
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
    fleetStorage === "supabase" ? supabaseFleetRepository : undefined,
    siteAssetsStorage === "supabase" ? supabaseSiteAssetRepository : undefined,
    siteContentStorage === "supabase" ? supabaseSiteContentRepository : undefined,
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
    await checkMongoReady();
    response.json(
      ApiReadinessSchema.parse({
        status: "ready",
        dependencies: { mongodb: "ok" },
      }),
    );
  } catch (error) {
    console.error(
      "MongoDB readiness check failed.",
      error instanceof Error ? error.message : String(error),
    );
    response.status(503).json(
      ApiReadinessSchema.parse({
        status: "not_ready",
        dependencies: { mongodb: "unavailable" },
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
  void connectToMongo().catch((error: unknown) => {
    console.error(
      "Initial MongoDB connection failed; readiness checks will retry.",
      error instanceof Error ? error.message : String(error),
    );
  });
});

let emailWorkerRunning = false;
let emailWorkerTask = Promise.resolve();
const emailWorkerTimer = setInterval(() => {
  if (
    emailWorkerRunning ||
    !process.env.MONGODB_URI?.trim() ||
    !process.env.SMTP_USER?.trim() ||
    !process.env.SMTP_APP_PASSWORD?.trim()
  ) return;
  emailWorkerRunning = true;
  emailWorkerTask = (async () => {
    let stage = "opening MongoDB repository and ensuring indexes";
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
      await closeMongo();
    } catch (closeError) {
      console.error("Failed to close the MongoDB connection cleanly.", closeError);
      process.exitCode = 1;
    }
  });
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
