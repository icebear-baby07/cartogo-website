import { Router, type Response as ExpressResponse } from "express";

type ChatMessage = { role: "user" | "assistant"; text: string };
type ChatbotConfig = { baseUrl?: string; fetcher?: typeof fetch };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateMessages(value: unknown): value is ChatMessage[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 11 &&
    value.every(
      (message) =>
        isRecord(message) &&
        (message.role === "user" || message.role === "assistant") &&
        typeof message.text === "string" &&
        message.text.trim().length > 0 &&
        message.text.length <= 10_000,
    )
  );
}

export function createChatbotRouter(config: ChatbotConfig = {}): Router {
  const router = Router();
  const fetcher = config.fetcher ?? fetch;
  const baseUrl = (config.baseUrl ?? "http://127.0.0.1:8003").replace(/\/+$/, "");

  router.post("/chatbot/chat", async (request, response: ExpressResponse) => {
    if (!isRecord(request.body) || !validateMessages(request.body.messages)) {
      response.status(400).json({ error: "Send up to eleven valid recent chat messages." });
      return;
    }
    if (Buffer.byteLength(JSON.stringify(request.body), "utf8") > 48 * 1024) {
      response.status(413).json({ error: "This conversation is too long to send. Start a new chat turn." });
      return;
    }

    const sessionId = request.get("X-Session-ID")?.trim() ?? "";
    const userId = request.get("X-User-ID")?.trim() ?? "";
    if (!sessionId || sessionId.length > 128 || !/^[A-Za-z0-9_-]+$/.test(sessionId)) {
      response.status(400).json({ error: "A valid chat session ID is required." });
      return;
    }
    if (!userId || userId.length > 128 || !/^[A-Za-z0-9_-]+$/.test(userId)) {
      response.status(400).json({ error: "A valid chat user ID is required." });
      return;
    }

    let chatbotResponse: globalThis.Response;
    try {
      chatbotResponse = await fetcher(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Session-ID": sessionId,
          "X-User-ID": userId,
        },
        body: JSON.stringify({ messages: request.body.messages }),
        signal: AbortSignal.timeout(45_000),
      });
    } catch (error) {
      console.error("Chatbot service request failed.", error instanceof Error ? error.name : "UnknownError");
      response.status(503).json({ error: "The chatbot is temporarily unavailable. Please try again." });
      return;
    }

    let payload: unknown;
    try {
      payload = await chatbotResponse.json();
    } catch {
      response.status(502).json({ error: "The chatbot returned an invalid response." });
      return;
    }
    if (!isRecord(payload)) {
      response.status(502).json({ error: "The chatbot returned an invalid response." });
      return;
    }
    response.status(chatbotResponse.status).json(payload);
  });

  return router;
}
