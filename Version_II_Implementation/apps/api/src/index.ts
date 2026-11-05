import "dotenv/config";
import express from "express";
import { checkMongoReady, closeMongo, connectToMongo } from "./mongo.js";

const app = express();
const port = Number(process.env.API_PORT ?? 3001);

app.disable("x-powered-by");
app.use(express.json({ limit: "16kb" }));

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok", service: "cartogo-version-ii-api" });
});

app.get("/api/health/ready", async (_request, response) => {
  try {
    await checkMongoReady();
    response.json({ status: "ready", dependencies: { mongodb: "ok" } });
  } catch (error) {
    console.error(
      "MongoDB readiness check failed.",
      error instanceof Error ? error.message : String(error),
    );
    response.status(503).json({
      status: "not_ready",
      dependencies: { mongodb: "unavailable" },
    });
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
