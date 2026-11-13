import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";

type ChatMessage = {
  role: "user" | "assistant";
  text: string;
  failed?: boolean;
};

type ChatMode = "assistant" | "agent";
type ChatSide = "left" | "right";
type ChatPosition = { side: ChatSide; y: number };

const CHAT_POSITION_STORAGE_KEY = "cartogoChatLauncherPosition";
const LEGACY_CHAT_CORNER_STORAGE_KEY = "cartogoChatLauncherCorner";
const CHAT_EDGE_GAP = 16;
const MIN_CHAT_POSITION = 0.08;
const MAX_CHAT_POSITION = 0.92;

function parseChatPosition(value: string | null): ChatPosition | null {
  if (!value) return null;
  const [side, rawY] = value.split(":");
  const y = Number(rawY);
  if ((side !== "left" && side !== "right") || !Number.isFinite(y)) return null;
  return { side, y: Math.min(MAX_CHAT_POSITION, Math.max(MIN_CHAT_POSITION, y)) };
}

function positionFromLegacyCorner(value: string | null): ChatPosition | null {
  if (!value) return null;
  if (value === "top-left") return { side: "left", y: 0.12 };
  if (value === "top-right") return { side: "right", y: 0.12 };
  if (value === "bottom-left") return { side: "left", y: 0.88 };
  if (value === "bottom-right") return { side: "right", y: 0.88 };
  return null;
}

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
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  const id = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  storage.setItem(key, id);
  return id;
}

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [panelMounted, setPanelMounted] = useState(false);
  const [position, setPosition] = useState<ChatPosition>({ side: "right", y: 0.88 });
  const [mobileLauncherTop, setMobileLauncherTop] = useState<number | null>(null);
  const [headerBottom, setHeaderBottom] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [launcherReturning, setLauncherReturning] = useState(false);
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
  const widget = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<number | null>(null);
  const returnTimer = useRef<number | null>(null);
  const wasOpen = useRef(false);
  const dragOrigin = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    centerX: number;
    centerY: number;
    bounds: { left: number; top: number; right: number; bottom: number };
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    setSessionId(getStoredId(window.sessionStorage, "cartogoChatSessionId"));
    setUserId(getStoredId(window.localStorage, "cartogoAnonymousUserId"));
    const savedPosition =
      parseChatPosition(window.localStorage.getItem(CHAT_POSITION_STORAGE_KEY)) ??
      positionFromLegacyCorner(window.localStorage.getItem(LEGACY_CHAT_CORNER_STORAGE_KEY));
    if (savedPosition) setPosition(savedPosition);
    setMobileLauncherTop((savedPosition?.y ?? 0.88) * window.innerHeight);
  }, []);

  useLayoutEffect(() => {
    const header = document.querySelector<HTMLElement>(".site-header");
    if (!header) return;

    const updateHeaderBottom = () => {
      const navigation = header.querySelector<HTMLElement>(".nav-links.is-open");
      const nextBottom = Math.max(
        0,
        header.getBoundingClientRect().bottom,
        navigation?.getBoundingClientRect().bottom ?? 0,
      );
      setHeaderBottom((current) =>
        Math.abs(current - nextBottom) < 0.5 ? current : nextBottom,
      );
    };

    updateHeaderBottom();
    window.addEventListener("scroll", updateHeaderBottom, { passive: true });
    window.addEventListener("resize", updateHeaderBottom);
    const observer = new MutationObserver(updateHeaderBottom);
    observer.observe(header, {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: ["class"],
    });

    return () => {
      window.removeEventListener("scroll", updateHeaderBottom);
      window.removeEventListener("resize", updateHeaderBottom);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (window.innerWidth > 740 || panelMounted || mobileLauncherTop === null) return;
    const minimumTop =
      headerBottom + CHAT_EDGE_GAP + (launcher.current?.offsetHeight ?? 54) / 2;
    setMobileLauncherTop((current) =>
      current === null || current >= minimumTop ? current : minimumTop,
    );
  }, [headerBottom, mobileLauncherTop, panelMounted]);

  useEffect(() => {
    const element = transcript.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages, busy, mode, agentPreview]);

  useEffect(() => {
    if (open && mode === "assistant") input.current?.focus();
  }, [open, mode]);

  useEffect(() => {
    if (!panelMounted && wasOpen.current) {
      launcher.current?.focus();
      wasOpen.current = false;
    } else if (open) {
      wasOpen.current = true;
    }
  }, [open, panelMounted]);

  useEffect(() => () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    if (returnTimer.current !== null) window.clearTimeout(returnTimer.current);
  }, []);

  useEffect(() => {
    if (mode !== "agent") return;
    setAgentReady(false);
    const timer = window.setTimeout(() => setAgentReady(true), 1800);
    return () => window.clearTimeout(timer);
  }, [mode]);

  function chooseAgent() {
    setMode("agent");
  }

  function openChat() {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    if (returnTimer.current !== null) window.clearTimeout(returnTimer.current);
    setLauncherReturning(false);
    setPanelMounted(true);
    window.requestAnimationFrame(() => setOpen(true));
  }

  function closeChat() {
    setOpen(false);
    setFullscreen(false);
    closeTimer.current = window.setTimeout(() => {
      setPanelMounted(false);
      setLauncherReturning(true);
      returnTimer.current = window.setTimeout(() => setLauncherReturning(false), 240);
    }, 240);
  }

  function savePosition(nextPosition: ChatPosition) {
    const normalized = {
      side: nextPosition.side,
      y: Math.min(MAX_CHAT_POSITION, Math.max(MIN_CHAT_POSITION, nextPosition.y)),
    };
    setPosition(normalized);
    if (window.innerWidth <= 740) {
      setMobileLauncherTop(normalized.y * window.innerHeight);
    }
    window.localStorage.setItem(
      CHAT_POSITION_STORAGE_KEY,
      `${normalized.side}:${normalized.y.toFixed(4)}`,
    );
  }

  function getAnchorY() {
    const viewportHeight = window.innerHeight;
    const widgetHeight = panelMounted
      ? panel.current?.offsetHeight ||
        Math.min(640, Math.max(0, viewportHeight - headerBottom - CHAT_EDGE_GAP * 2))
      : launcher.current?.offsetHeight || 54;
    const minimum = headerBottom + CHAT_EDGE_GAP + widgetHeight / 2;
    const maximum = viewportHeight - CHAT_EDGE_GAP - widgetHeight / 2;
    if (fullscreen || maximum < minimum) return minimum;
    return Math.max(minimum, Math.min(maximum, position.y * viewportHeight));
  }

  function startDragging(event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0 || fullscreen) return;
    if (
      panelMounted &&
      event.target instanceof Element &&
      event.target.closest("button")
    ) {
      return;
    }
    const bounds = widget.current?.getBoundingClientRect();
    if (!bounds) return;
    dragOrigin.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      centerX: bounds.left + bounds.width / 2,
      centerY: bounds.top + bounds.height / 2,
      bounds: {
        left: bounds.left,
        top: bounds.top,
        right: bounds.right,
        bottom: bounds.bottom,
      },
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveWidget(event: ReactPointerEvent<HTMLElement>) {
    const origin = dragOrigin.current;
    if (!origin || origin.pointerId !== event.pointerId) return;
    const rawX = event.clientX - origin.startX;
    const rawY = event.clientY - origin.startY;
    const x = Math.min(
      window.innerWidth - 12 - origin.bounds.right,
      Math.max(12 - origin.bounds.left, rawX),
    );
    const minimumY = headerBottom + CHAT_EDGE_GAP - origin.bounds.top;
    const maximumY = window.innerHeight - CHAT_EDGE_GAP - origin.bounds.bottom;
    const y = Math.max(minimumY, Math.min(maximumY, rawY));
    if (!origin.moved && Math.hypot(x, y) < 6) return;
    origin.moved = true;
    setDragging(true);
    setDragOffset({ x, y });
    event.preventDefault();
  }

  function finishDragging(event: ReactPointerEvent<HTMLElement>) {
    const origin = dragOrigin.current;
    if (!origin || origin.pointerId !== event.pointerId) return;
    dragOrigin.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!origin.moved) return;

    const rawX = origin.centerX + event.clientX - origin.startX;
    const rawY = origin.centerY + event.clientY - origin.startY;
    const side: ChatSide = rawX < window.innerWidth / 2 ? "left" : "right";
    const widgetHeight = origin.bounds.bottom - origin.bounds.top;
    const minimum = Math.max(
      MIN_CHAT_POSITION,
      (headerBottom + CHAT_EDGE_GAP + widgetHeight / 2) / window.innerHeight,
    );
    const maximum = Math.max(
      minimum,
      Math.min(
        MAX_CHAT_POSITION,
        1 - (CHAT_EDGE_GAP + widgetHeight / 2) / window.innerHeight,
      ),
    );
    const y = Math.max(minimum, Math.min(maximum, rawY / window.innerHeight));
    savePosition({ side, y });
    setDragOffset({ x: 0, y: 0 });
    setDragging(false);
    suppressClick.current = true;
    window.setTimeout(() => {
      suppressClick.current = false;
    }, 0);
  }

  function cancelDragging() {
    dragOrigin.current = null;
    setDragOffset({ x: 0, y: 0 });
    setDragging(false);
  }

  function moveWithArrowKey(event: ReactKeyboardEvent<HTMLButtonElement>) {
    let nextPosition: ChatPosition | undefined;
    if (event.key === "ArrowLeft") nextPosition = { ...position, side: "left" };
    if (event.key === "ArrowRight") nextPosition = { ...position, side: "right" };
    if (event.key === "ArrowUp") nextPosition = { ...position, y: position.y - 0.08 };
    if (event.key === "ArrowDown") nextPosition = { ...position, y: position.y + 0.08 };
    if (
      nextPosition &&
      (nextPosition.side !== position.side || nextPosition.y !== position.y)
    ) {
      event.preventDefault();
      savePosition(nextPosition);
    }
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
    createPortal(
    <>
      {panelMounted ? (
        <button
          className={`chat-backdrop${open ? " is-visible" : ""}`}
          type="button"
          tabIndex={-1}
          aria-label="Close Cartogo chat"
          onClick={closeChat}
        />
      ) : null}
      <div
        ref={widget}
        className={`chatbot-widget${panelMounted ? " is-open" : ""}${fullscreen ? " is-fullscreen" : ""}${dragging ? " is-dragging" : ""}${launcherReturning ? " is-returning" : ""}`}
        data-side={position.side}
        onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) => {
          if (event.key === "Escape" && open) closeChat();
        }}
        style={!fullscreen ? {
          top: !panelMounted && window.innerWidth <= 740 && mobileLauncherTop !== null
            ? `${mobileLauncherTop}px`
            : `${getAnchorY()}px`,
          transform: dragging
            ? `translate(${dragOffset.x}px, calc(-50% + ${dragOffset.y}px))`
            : undefined,
        } : undefined}
      >
      {!panelMounted ? (
        <button
          ref={launcher}
          className="chat-launcher"
          type="button"
          aria-label="Open Cartogo chat. Drag to move along either side, or use arrow keys to reposition."
          title="Drag to move along either side; use arrow keys to reposition"
          onPointerDown={startDragging}
          onPointerMove={moveWidget}
          onPointerUp={finishDragging}
          onPointerCancel={cancelDragging}
          onKeyDown={moveWithArrowKey}
          onClick={() => {
            if (suppressClick.current) {
              suppressClick.current = false;
              return;
            }
            openChat();
          }}
        >
          <i className="fa-solid fa-comment-dots" aria-hidden="true" />
          <span>Ask carTOGO</span>
        </button>
      ) : (
        <section
          ref={panel}
          className={`chat-panel${open ? " is-visible" : ""}`}
          aria-hidden={!open}
          aria-label={mode === "assistant" ? "Cartogo assistant chat" : "Cartogo agent preview"}
        >
          <header
            className={`chat-panel-header${dragging ? " is-dragging" : ""}`}
            onPointerDown={startDragging}
            onPointerMove={moveWidget}
            onPointerUp={finishDragging}
            onPointerCancel={cancelDragging}
          >
            <div>
              <strong>{mode === "assistant" ? "Cartogo assistant" : "Cartogo agent preview"}</strong>
              <span>{mode === "assistant" ? "AI assistant · CB" : agentReady ? "Preview only · Not connected" : "Preparing a preview…"}</span>
            </div>
            <div className="chat-header-actions">
              <button type="button" aria-label={fullscreen ? "Exit fullscreen" : "Expand chat"} onClick={() => setFullscreen((value) => !value)}>
                {fullscreen ? "↙" : "↗"}
              </button>
              <button type="button" aria-label="Close chat" onClick={closeChat}>×</button>
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
    </>,
    document.body,
    )
  );
}
