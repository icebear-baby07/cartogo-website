const CHATBOT_CONFIG = {
  model: "qwen3:8b-q4",
  endpoint: "",
  welcome: "Hi. I can help you compare cars, understand rates, and find the right pickup option. What are you planning?"
};

let activeChatSession;

document.addEventListener("DOMContentLoaded", initChatbot);

async function initChatbot() {
  activeChatSession = {
    id: `chat_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    username: "Guest",
    startedAt: new Date().toISOString(),
    lastMessageAt: new Date().toISOString(),
    messages: []
  };
  bindChatbotEvents();
  await appendChatMessage("assistant", CHATBOT_CONFIG.welcome);
}

function bindChatbotEvents() {
  const shell = document.getElementById("chatbotShell");
  const windowEl = document.getElementById("chatbotWindow");
  const launcher = document.getElementById("chatbotLauncher");
  const close = document.getElementById("chatbotClose");
  const expand = document.getElementById("chatbotExpand");
  const form = document.getElementById("chatbotForm");
  const input = document.getElementById("chatbotInput");

  launcher.addEventListener("click", () => {
    const isOpen = !windowEl.hidden;
    windowEl.hidden = isOpen;
    launcher.setAttribute("aria-expanded", String(!isOpen));
    if (!isOpen) input.focus();
  });
  close.addEventListener("click", () => {
    windowEl.hidden = true;
    shell.classList.remove("expanded");
    launcher.setAttribute("aria-expanded", "false");
  });
  expand.addEventListener("click", () => shell.classList.toggle("expanded"));
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const value = input.value.trim();
    if (!value) return;
    input.value = "";
    await appendChatMessage("user", value);
    await appendChatMessage("assistant", "I’m ready for Qwen 3 8B Q4. Connect the model endpoint to enable live answers, and I’ll use carTOGO’s fleet and FAQ data here.");
  });
}

async function appendChatMessage(role, content) {
  const message = { role, content, createdAt: new Date().toISOString() };
  activeChatSession.messages.push(message);
  activeChatSession.lastMessageAt = message.createdAt;
  const messages = document.getElementById("chatbotMessages");
  const item = document.createElement("div");
  item.className = `chatbot-message ${role}`;
  item.textContent = content;
  messages.appendChild(item);
  messages.scrollTop = messages.scrollHeight;
  await DB.saveChatSession(activeChatSession);
}