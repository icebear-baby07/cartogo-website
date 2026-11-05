import dotenv from "dotenv";
import express from "express";
import { fileURLToPath } from "node:url";
import { ApiHealthSchema, ApiReadinessSchema } from "@cartogo/contracts";
import {
  checkMongoReady,
  closeMongo,
  connectToMongo,
  getAdminDataRepository,
  getPublicDataRepository,
} from "./mongo.js";
import { createAuthRouter, createRequireAdmin } from "./auth.js";
import { createAdminRouter } from "./admin-api.js";
import { createPublicDataRouter } from "./public-data.js";

dotenv.config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

const app = express();
const port = Number(process.env.API_PORT ?? 3001);
const supabaseAuthConfig = {
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
};

app.disable("x-powered-by");
app.use(express.json({ limit: "16kb" }));
app.use("/api/admin", createRequireAdmin(supabaseAuthConfig));
app.use("/api", createAuthRouter(supabaseAuthConfig));
app.use("/api/admin", createAdminRouter(getAdminDataRepository, {
  ...supabaseAuthConfig,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  initialOwnerEmail: process.env.CARTOGO_INITIAL_OWNER_EMAIL || "remuelfernan07@gmail.com",
  smtpUser: process.env.SMTP_USER,
  smtpPassword: process.env.SMTP_APP_PASSWORD,
  smtpHost: process.env.SMTP_HOST,
  smtpPort: process.env.SMTP_PORT,
  smtpFrom: process.env.SMTP_FROM,
}));
app.use("/api", createPublicDataRouter(getPublicDataRepository));

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

const server = app.listen(port, "127.0.0.1", () => {
  console.log(`Version II API listening at http://127.0.0.1:${port}`);
  void connectToMongo().catch((error: unknown) => {
    console.error(
      "Initial MongoDB connection failed; readiness checks will retry.",
      error instanceof Error ? error.message : String(error),
    );
  });
});

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
  server.close(async (error) => {
    if (error) {
      console.error("Failed to close the HTTP server cleanly.", error);
      process.exitCode = 1;
    }
    try {
      await closeMongo();
    } catch (closeError) {
      console.error("Failed to close the MongoDB connection cleanly.", closeError);
      process.exitCode = 1;
    }
  });
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
