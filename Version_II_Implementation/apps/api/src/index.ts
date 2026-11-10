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
const supabaseAuthConfig = {
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
};
const bookingEmailConfig = {
  smtpUser: process.env.SMTP_USER,
  smtpPassword: process.env.SMTP_APP_PASSWORD,
  smtpHost: process.env.SMTP_HOST,
  smtpPort: process.env.SMTP_PORT,
  smtpFrom: process.env.SMTP_FROM,
  verificationSecret: process.env.GUEST_EMAIL_VERIFICATION_SECRET
    || process.env.SMTP_APP_PASSWORD,
};
const bookingConfig = {
  ...bookingEmailConfig,
  supabaseUrl: supabaseAuthConfig.supabaseUrl,
  supabaseAnonKey: supabaseAuthConfig.supabaseAnonKey,
  recordEmailActivity,
  verifyGoogleUser: (accessToken: string) =>
    verifyGoogleBookingUser(accessToken, supabaseAuthConfig),
};
const sendBookingMail = createBookingMailer(bookingEmailConfig);

app.disable("x-powered-by");
app.use("/api/chatbot", express.json({ limit: "48kb" }));
app.use(express.json({ limit: "16kb" }));
app.use("/api/admin", createRequireAdmin(supabaseAuthConfig));
app.use("/api", createAuthRouter(supabaseAuthConfig));
app.use("/api/admin", createAdminRouter(getAdminDataRepository, {
  smtpUser: process.env.SMTP_USER,
  smtpPassword: process.env.SMTP_APP_PASSWORD,
  smtpHost: process.env.SMTP_HOST,
  smtpPort: process.env.SMTP_PORT,
  smtpFrom: process.env.SMTP_FROM,
  recordEmailActivity,
}));
app.use("/api", createPublicDataRouter(getPublicDataRepository));
app.use("/api", createBookingRouter(getBookingRepository, bookingConfig));
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
      const repository = await getBookingRepository();
      stage = "claiming or updating the confirmation-email outbox";
      await runInquiryConfirmationWorker(repository, sendBookingMail, recordEmailActivity);
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
