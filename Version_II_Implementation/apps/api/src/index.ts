import express from "express";

const app = express();
const port = Number(process.env.API_PORT ?? 3001);

app.disable("x-powered-by");
app.use(express.json({ limit: "16kb" }));

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok", service: "cartogo-version-ii-api" });
});

const server = app.listen(port, "127.0.0.1", () => {
  console.log(`Version II API listening at http://127.0.0.1:${port}`);
});

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(`API port ${port} is already in use. Set API_PORT to another port.`);
    process.exitCode = 1;
    return;
  }
  throw error;
});
