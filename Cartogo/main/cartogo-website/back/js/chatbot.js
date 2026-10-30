const CHATBOT_PORT = 8001;
const CHATBOT_URL = new URL(`http://${window.location.hostname}:${CHATBOT_PORT}/`);
const chatbotShell = document.getElementById("chatbotShell");
const chatbotLauncher = document.getElementById("chatbotLauncher");
const chatbotFrame = document.getElementById("chatbotFrame");
const siteHeader = document.getElementById("siteHeader");
const accountDialog = document.getElementById("accountDialog");
const accountDialogClose = document.getElementById("accountDialogClose");
let activeChatSession = null;
let activeChatIdentity = null;
let launcherDrag = null;
let suppressLauncherClick = false;
let chatCloseTimer = null;
const CHAT_STATE_TRANSITION_MS = 220;

const updateChatbotHeaderOffset = () => {
  document.documentElement.style.setProperty("--chatbot-header-offset", `${siteHeader?.getBoundingClientRect().bottom || 0}px`);
};
updateChatbotHeaderOffset();
window.addEventListener("resize", updateChatbotHeaderOffset);
window.addEventListener("scroll", updateChatbotHeaderOffset, { passive: true });

function getVerifiedGoogleIdentity(user) {
  const providers = [
    user?.app_metadata?.provider,
    ...(Array.isArray(user?.app_metadata?.providers) ? user.app_metadata.providers : []),
    ...(Array.isArray(user?.identities) ? user.identities.map(identity => identity.provider) : [])
  ];
  const emailVerified = user?.user_metadata?.email_verified === true
    || user?.user_metadata?.email_verified === "true"
    || Boolean(user?.email_confirmed_at || user?.confirmed_at);
  if (!user?.id || !providers.includes("google") || !emailVerified) return null;
  const profile = user.user_metadata || {};
  const name = String(profile.full_name || profile.name || [
    profile.given_name,
    profile.middle_name,
    profile.family_name
  ].filter(Boolean).join(" ") || "Google user").trim().slice(0, 160);
  return { userId: user.id, username: name || "Google user" };
}

function syncChatAccountState() {
  if (!chatbotFrame.hasAttribute("src") || !chatbotFrame.contentWindow) return;
  chatbotFrame.contentWindow.postMessage({
    type: "cartogo-chat-account-state",
    account: activeChatIdentity
      ? { authenticated: true, userId: activeChatIdentity.userId, username: activeChatIdentity.username }
      : { authenticated: false }
  }, CHATBOT_URL.origin);
}

function updateChatAccountIdentity(user) {
  activeChatIdentity = getVerifiedGoogleIdentity(user);
  syncChatAccountState();
  if (!activeChatIdentity || !activeChatSession
    || (activeChatSession.userId && activeChatSession.userId !== activeChatIdentity.userId)) return;
  activeChatSession.userId = activeChatIdentity.userId;
  activeChatSession.username = activeChatIdentity.username;
  const session = activeChatSession;
  window.setTimeout(() => {
    DB.saveChatSession(session).catch(error => console.error("Chat session account binding could not be saved.", error));
  }, 0);
}

chatbotFrame.addEventListener("load", syncChatAccountState);
supabaseAuthSession();
supa.auth.onAuthStateChange((_event, session) => updateChatAccountIdentity(session?.user || null));

function supabaseAuthSession() {
  supa.auth.getSession().then(({ data, error }) => {
    if (error) {
      console.error("Chat account sign-in status could not be checked.", error);
      return;
    }
    updateChatAccountIdentity(data.session?.user || null);
  }).catch(error => console.error("Chat account sign-in status could not be checked.", error));
}

const openChat = () => {
  clearTimeout(chatCloseTimer);
  chatbotShell.classList.remove("is-closing", "is-returning");
  chatbotShell.classList.add("is-open", "is-opening");
  chatbotLauncher.hidden = true;
  chatbotLauncher.setAttribute("aria-expanded", "true");
  chatbotFrame.hidden = false;
  chatbotFrame.src = `${CHATBOT_URL}?embed=1&v=account-chat-hint-20261030`;
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => chatbotShell.classList.remove("is-opening"));
  });
};

const closeChat = () => {
  if (!chatbotShell.classList.contains("is-open")) return;
  clearTimeout(chatCloseTimer);
  chatbotShell.classList.remove("is-opening");
  chatbotShell.classList.add("is-closing");
  chatbotLauncher.hidden = true;
  chatCloseTimer = window.setTimeout(() => {
    chatbotFrame.hidden = true;
    chatbotFrame.removeAttribute("src");
    chatbotShell.classList.remove("expanded", "is-open", "is-closing");
    chatbotLauncher.hidden = false;
    chatbotLauncher.setAttribute("aria-expanded", "false");
    chatbotLauncher.classList.remove("is-label-expanded");
    chatbotLauncher.setAttribute("aria-label", "Open carTOGO chat; drag to move launcher");
    chatbotLauncher.removeAttribute("title");
    chatbotShell.classList.add("is-returning");
    window.setTimeout(() => chatbotShell.classList.remove("is-returning"), CHAT_STATE_TRANSITION_MS);
    chatbotLauncher.focus();
  }, CHAT_STATE_TRANSITION_MS);
};

chatbotLauncher.addEventListener("click", event => {
  if (suppressLauncherClick) {
    event.preventDefault();
    suppressLauncherClick = false;
    return;
  }
  if (window.matchMedia("(hover: none)").matches && !chatbotLauncher.classList.contains("is-label-expanded")) {
    chatbotLauncher.classList.add("is-label-expanded");
    chatbotLauncher.setAttribute("aria-label", "Tap again to open carTOGO chat");
    chatbotLauncher.title = "Tap again to open chat";
    return;
  }
  chatbotLauncher.classList.remove("is-label-expanded");
  chatbotLauncher.setAttribute("aria-label", "Open carTOGO chat; drag to move launcher");
  chatbotLauncher.removeAttribute("title");
  openChat();
});

chatbotLauncher.addEventListener("pointerdown", event => {
  if (!event.isPrimary || event.button !== 0) return;
  const bounds = chatbotShell.getBoundingClientRect();
  launcherDrag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    offsetX: event.clientX - bounds.left,
    offsetY: event.clientY - bounds.top,
    moved: false
  };
  try {
    chatbotLauncher.setPointerCapture(event.pointerId);
  } catch {
  }
});

chatbotLauncher.addEventListener("pointermove", event => {
  if (!launcherDrag || launcherDrag.pointerId !== event.pointerId) return;
  if (!launcherDrag.moved && Math.hypot(event.clientX - launcherDrag.startX, event.clientY - launcherDrag.startY) < 6) return;
  if (!launcherDrag.moved) {
    launcherDrag.moved = true;
    chatbotShell.classList.add("is-dragging");
    chatbotShell.style.right = "auto";
    chatbotShell.style.bottom = "auto";
  }
  const maxLeft = Math.max(0, window.innerWidth - chatbotShell.offsetWidth);
  const maxTop = Math.max(0, window.innerHeight - chatbotShell.offsetHeight);
  chatbotShell.style.left = `${Math.min(maxLeft, Math.max(0, event.clientX - launcherDrag.offsetX))}px`;
  chatbotShell.style.top = `${Math.min(maxTop, Math.max(0, event.clientY - launcherDrag.offsetY))}px`;
});

const finishLauncherDrag = event => {
  if (!launcherDrag || launcherDrag.pointerId !== event.pointerId) return;
  if (launcherDrag.moved) {
    const bounds = chatbotShell.getBoundingClientRect();
    const leftSide = bounds.left + bounds.width / 2 < window.innerWidth / 2;
    const topSide = bounds.top + bounds.height / 2 < window.innerHeight / 2;
    chatbotShell.dataset.corner = `${topSide ? "top" : "bottom"}-${leftSide ? "left" : "right"}`;
    chatbotShell.style.removeProperty("left");
    chatbotShell.style.removeProperty("top");
    chatbotShell.style.removeProperty("right");
    chatbotShell.style.removeProperty("bottom");
    chatbotShell.classList.remove("is-dragging");
    suppressLauncherClick = true;
    window.setTimeout(() => { suppressLauncherClick = false; }, 400);
  }
  launcherDrag = null;
};

chatbotLauncher.addEventListener("pointerup", finishLauncherDrag);
chatbotLauncher.addEventListener("pointercancel", finishLauncherDrag);

document.addEventListener("click", event => {
  if (chatbotShell.contains(event.target)) return;
  chatbotLauncher.classList.remove("is-label-expanded");
  chatbotLauncher.setAttribute("aria-label", "Open carTOGO chat; drag to move launcher");
  chatbotLauncher.removeAttribute("title");
});

window.addEventListener("message", event => {
  if (event.source !== chatbotFrame.contentWindow || event.origin !== CHATBOT_URL.origin) return;
  if (event.data?.type === "cartogo-chat-close") {
    closeChat();
  } else if (event.data?.type === "cartogo-chat-fullscreen") {
    chatbotShell.classList.toggle("expanded", event.data.enabled === true);
  } else if (event.data?.type === "cartogo-chat-ready") {
    syncChatAccountState();
  } else if (event.data?.type === "cartogo-chat-account-request") {
    if (!accountDialog.open) accountDialog.showModal();
    accountDialogClose.focus();
  } else if (event.data?.type === "cartogo-chat-message") {
    saveChatMessage(event.data);
  }
});

function saveChatMessage(data) {
  if (!data.sessionId || !["user", "assistant"].includes(data.role) || typeof data.content !== "string") return;
  if (!activeChatSession || activeChatSession.id !== data.sessionId) {
    activeChatSession = {
      id: data.sessionId,
      username: activeChatIdentity?.username || "Guest",
      userId: activeChatIdentity?.userId || null,
      startedAt: data.createdAt,
      lastMessageAt: data.createdAt,
      messages: []
    };
  }
  if (activeChatIdentity) {
    activeChatSession.username = activeChatIdentity.username;
    activeChatSession.userId = activeChatIdentity.userId;
  }
  activeChatSession.messages.push({ role: data.role, content: data.content, createdAt: data.createdAt });
  activeChatSession.lastMessageAt = data.createdAt;
  DB.saveChatSession(activeChatSession).catch(error => console.error("Chat session could not be saved.", error));
}