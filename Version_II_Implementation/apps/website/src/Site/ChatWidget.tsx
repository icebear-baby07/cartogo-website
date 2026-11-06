import { useEffect, useRef, useState, type FormEvent } from "react";

type ChatMessage = {
  role: "user" | "assistant";
  text: string;
  failed?: boolean;
};

type ChatMode = "assistant" | "agent";

const suggestions = [
  "What vehicles are available?",
  "What are the rates for the Toyota Fortuner?",
  "I need help with a booking",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getStoredId(storage: Storage, key: string): string {
  const current = storage.getItem(key);
  if (current && /^[A-Za-z0-9_-]{1,128}$/.test(current)) return current;
  const id = crypto.randomUUID().replaceAll("-", "");
  storage.setItem(key, id);
  return id;
}

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [mode, setMode] = useState<ChatMode>("assistant");
  const [agentReady, setAgentReady] = useState(false);
  const [agentPreview, setAgentPreview] = useState<string[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [promptVisible, setPromptVisible] = useState(true);
  const [sessionId, setSessionId] = useState("");
  const [userId, setUserId] = useState("");
  const transcript = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSessionId(getStoredId(window.sessionStorage, "cartogoChatSessionId"));
    setUserId(getStoredId(window.localStorage, "cartogoAnonymousUserId"));
  }, []);

  useEffect(() => {
    const element = transcript.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages, busy, mode, agentPreview]);

  useEffect(() => {
    if (open && mode === "assistant") input.current?.focus();
  }, [open, mode]);

  useEffect(() => {
    if (mode !== "agent") return;
    setAgentReady(false);
    const timer = window.setTimeout(() => setAgentReady(true), 1800);
    return () => window.clearTimeout(timer);
  }, [mode]);

  function chooseAgent() {
    setMode("agent");
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || busy || !sessionId || !userId) return;
    setDraft("");
    if (mode === "agent") {
      if (agentReady) setAgentPreview((current) => [...current, message]);
      return;
    }

    const history: { role: "user" | "assistant"; text: string }[] = [];
    for (let index = 0; index + 1 < messages.length; index += 2) {
      const userMessage = messages[index];
      const assistantMessage = messages[index + 1];
      if (
        userMessage.role === "user" &&
        assistantMessage.role === "assistant" &&
        !assistantMessage.failed
      ) {
        history.push(
          { role: "user", text: userMessage.text },
          { role: "assistant", text: assistantMessage.text },
        );
      }
    }
    let historyCharacters = 0;
    const recentHistory: typeof history = [];
    for (const item of history.slice(-10).reverse()) {
      if (historyCharacters + item.text.length > 32_000) break;
      recentHistory.unshift(item);
      historyCharacters += item.text.length;
    }
    setMessages((current) => [...current, { role: "user", text: message }]);
    setBusy(true);
    try {
      const response = await fetch("/api/chatbot/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Session-ID": sessionId,
          "X-User-ID": userId,
        },
        body: JSON.stringify({ messages: [...recentHistory, { role: "user", text: message }] }),
      });
      const result: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          isRecord(result) && typeof result.error === "string"
            ? result.error
            : "The assistant could not complete this request.",
        );
      }
      if (!isRecord(result) || typeof result.reply !== "string" || !result.reply.trim()) {
        throw new Error("The assistant returned an invalid response.");
      }
      const reply = result.reply;
      setMessages((current) => [...current, { role: "assistant", text: reply }]);
    } catch (sendError) {
      const messageText = sendError instanceof Error ? sendError.message : "The assistant is unavailable.";
      setMessages((current) => [...current, { role: "assistant", text: messageText, failed: true }]);
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  }

  return (
    <div className={`chatbot-widget${fullscreen ? " is-fullscreen" : ""}`}>
      {!open ? (
        <button className="chat-launcher" type="button" aria-label="Open Cartogo chat" onClick={() => setOpen(true)}>
          <i className="fa-solid fa-comment-dots" aria-hidden="true" />
          <span>Ask carTOGO</span>
        </button>
      ) : (
        <section className="chat-panel" aria-label={mode === "assistant" ? "Cartogo assistant chat" : "Cartogo agent preview"}>
          <header className="chat-panel-header">
            <div>
              <strong>{mode === "assistant" ? "Cartogo assistant" : "Cartogo agent preview"}</strong>
              <span>{mode === "assistant" ? "AI assistant · CB" : agentReady ? "Preview only · Not connected" : "Preparing a preview…"}</span>
            </div>
            <div className="chat-header-actions">
              <button type="button" aria-label={fullscreen ? "Exit fullscreen" : "Expand chat"} onClick={() => setFullscreen((value) => !value)}>
                {fullscreen ? "↙" : "↗"}
              </button>
              <button type="button" aria-label="Close chat" onClick={() => { setOpen(false); setFullscreen(false); }}>×</button>
            </div>
          </header>
          <div className="chat-mode-switch" role="group" aria-label="Choose chat mode">
            <button type="button" className={mode === "assistant" ? "is-active" : ""} aria-pressed={mode === "assistant"} onClick={() => setMode("assistant")}>Assistant</button>
            <button type="button" className={mode === "agent" ? "is-active" : ""} aria-pressed={mode === "agent"} onClick={chooseAgent}>Agent</button>
          </div>
          <div className="chat-transcript" ref={transcript} aria-live="polite">
            {mode === "assistant" ? (
              <>
                <div className="chat-message assistant-message"><strong>Cartogo assistant</strong><p>Hi there! What can I help you with today?</p><p>I can help with vehicle availability, rates, and general rental questions.</p></div>
                {!messages.length ? (
                  <div className="chat-suggestions">
                    <span>Suggested questions</span>
                    {suggestions.map((suggestion) => (
                      <button key={suggestion} type="button" disabled={busy} onClick={() => setDraft(suggestion)}>{suggestion}</button>
                    ))}
                  </div>
                ) : null}
                {messages.map((item, index) => (
                  <div className={`chat-message ${item.role === "user" ? "user-message" : "assistant-message"}${item.failed ? " is-error" : ""}`} key={`${item.role}-${index}`} role={item.failed ? "alert" : undefined}>
                    {item.role === "assistant" ? <strong>Cartogo assistant</strong> : null}
                    <p>{item.text}</p>
                  </div>
                ))}
                {busy ? <div className="chat-message assistant-message" role="status"><strong>Cartogo assistant</strong><p>Thinking…</p></div> : null}
              </>
            ) : (
              <div className="agent-preview">
                {!agentReady ? (
                  <>
                    <span className="agent-pulse" aria-hidden="true">•••</span>
                    <h2>Connecting you with an agent</h2>
                    <p>Preparing the agent chat preview…</p>
                  </>
                ) : (
                  <>
                    <p className="preview-disclaimer" role="status">Preview only. This is not a live support queue. Messages are not sent or saved.</p>
                    <p className="agent-system-message">Agent chat preview is ready. You can switch back to the assistant at any time.</p>
                    {agentPreview.map((item, index) => <p className="agent-preview-message" key={index}>{item}</p>)}
                  </>
                )}
              </div>
            )}
          </div>
          <footer className="chat-panel-footer">
            {mode === "assistant" ? (
              <>
                {promptVisible ? <div className="chat-contact-prompt"><span>A little help from Cartogo</span><button type="button" onClick={chooseAgent}>Talk to an expert</button><button type="button" aria-label="Dismiss expert prompt" onClick={() => setPromptVisible(false)}>×</button></div> : null}
                <form className="chat-composer" onSubmit={(event) => void sendMessage(event)}>
                  <input ref={input} value={draft} maxLength={10_000} disabled={busy || !sessionId || !userId} autoComplete="off" placeholder="Write a message…" aria-label="Write a message" onChange={(event) => setDraft(event.target.value)} />
                  <button type="submit" disabled={busy || !sessionId || !userId || !draft.trim()} aria-label="Send message">Send</button>
                </form>
              </>
            ) : (
              <>
                <p>Preview only · not connected to a live agent</p>
                <form className="chat-composer" onSubmit={(event) => void sendMessage(event)}>
                  <input value={draft} maxLength={10_000} disabled={!agentReady} autoComplete="off" placeholder="Write a preview message…" aria-label="Write a preview message" onChange={(event) => setDraft(event.target.value)} />
                  <button type="submit" disabled={!agentReady || !draft.trim()} aria-label="Send preview message">Send</button>
                </form>
              </>
            )}
          </footer>
        </section>
      )}
    </div>
  );
}
