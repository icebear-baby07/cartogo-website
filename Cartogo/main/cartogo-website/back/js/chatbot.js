const CHATBOT_PORT = 8001;
const CHATBOT_URL = new URL(`http://${window.location.hostname}:${CHATBOT_PORT}/`);
const chatbotShell = document.getElementById("chatbotShell");
const chatbotLauncher = document.getElementById("chatbotLauncher");
const chatbotFrame = document.getElementById("chatbotFrame");
let activeChatSession = null;

chatbotLauncher.addEventListener("click", () => {
  chatbotShell.classList.add("is-open");
  chatbotLauncher.hidden = true;
  chatbotLauncher.setAttribute("aria-expanded", "true");
  chatbotFrame.hidden = false;
  chatbotFrame.src = `${CHATBOT_URL}?embed=1`;
});

window.addEventListener("message", event => {
  if (event.source !== chatbotFrame.contentWindow || event.origin !== CHATBOT_URL.origin) return;
  if (event.data?.type === "cartogo-chat-close") {
    chatbotFrame.hidden = true;
    chatbotFrame.removeAttribute("src");
    chatbotShell.classList.remove("expanded", "is-open");
    chatbotLauncher.hidden = false;
    chatbotLauncher.setAttribute("aria-expanded", "false");
    chatbotLauncher.focus();
  } else if (event.data?.type === "cartogo-chat-fullscreen") {
    chatbotShell.classList.toggle("expanded", event.data.enabled === true);
  } else if (event.data?.type === "cartogo-chat-message") {
    saveChatMessage(event.data);
  }
});

function saveChatMessage(data) {
  if (!data.sessionId || !["user", "assistant"].includes(data.role) || typeof data.content !== "string") return;
  if (!activeChatSession || activeChatSession.id !== data.sessionId) {
    activeChatSession = {
      id: data.sessionId,
      username: "Guest",
      startedAt: data.createdAt,
      lastMessageAt: data.createdAt,
      messages: []
    };
  }
  activeChatSession.messages.push({ role: data.role, content: data.content, createdAt: data.createdAt });
  activeChatSession.lastMessageAt = data.createdAt;
  DB.saveChatSession(activeChatSession).catch(error => console.error("Chat session could not be saved.", error));
}