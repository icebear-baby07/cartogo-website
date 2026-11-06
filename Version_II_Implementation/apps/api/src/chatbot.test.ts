import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import test from "node:test";
import { createChatbotRouter } from "./chatbot.js";

async function request(
  router: express.Router,
  body: unknown,
  headers: Record<string, string> = {
    "X-Session-ID": "session-123",
    "X-User-ID": "user-123",
  },
): Promise<Response> {
  const app = express();
  app.use(express.json({ limit: "64kb" }));
  app.use("/api", router);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    return await fetch(`http://127.0.0.1:${address.port}/api/chatbot/chat`, {
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

test("validates chatbot messages before forwarding", async () => {
  let called = false;
  const response = await request(
    createChatbotRouter({
      fetcher: async () => {
        called = true;
        return Response.json({ reply: "ok" });
      },
    }),
    { messages: [{ role: "system", text: "not allowed" }] },
  );
  assert.equal(response.status, 400);
  assert.equal(called, false);
});

test("rejects oversized messages before forwarding to the chatbot", async () => {
  let called = false;
  const response = await request(
    createChatbotRouter({
      fetcher: async () => {
        called = true;
        return Response.json({ reply: "ok" });
      },
    }),
    { messages: [{ role: "user", text: "x".repeat(10_000) }, ...Array.from(
      { length: 6 },
      () => ({ role: "assistant", text: "x".repeat(7_500) }),
    )] },
  );
  assert.equal(response.status, 413);
  assert.equal(called, false);
});

test("forwards the legacy chatbot request contract and response", async () => {
  let targetUrl = "";
  let forwardedSession = "";
  let forwardedUser = "";
  let requestBody: unknown;
  const response = await request(
    createChatbotRouter({
      baseUrl: "http://chatbot.local/",
      fetcher: async (input, init) => {
        targetUrl = String(input);
        const headers = new Headers(init?.headers);
        forwardedSession = headers.get("X-Session-ID") ?? "";
        forwardedUser = headers.get("X-User-ID") ?? "";
        requestBody = JSON.parse(String(init?.body));
        return Response.json({ reply: "Hello from CB." });
      },
    }),
    { messages: [{ role: "user", text: "Hello" }] },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { reply: "Hello from CB." });
  assert.equal(targetUrl, "http://chatbot.local/api/chat");
  assert.equal(forwardedSession, "session-123");
  assert.equal(forwardedUser, "user-123");
  assert.deepEqual(requestBody, { messages: [{ role: "user", text: "Hello" }] });
});

test("reports an unavailable chatbot without exposing upstream details", async () => {
  const response = await request(
    createChatbotRouter({
      fetcher: async () => {
        throw new Error("private upstream host detail");
      },
    }),
    { messages: [{ role: "user", text: "Hello" }] },
  );
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: "The chatbot is temporarily unavailable. Please try again.",
  });
});
