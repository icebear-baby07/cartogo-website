const launcher = document.querySelector("#chatLauncher");
const chatWindow = document.querySelector("#chatWindow");
const collapseButton = document.querySelector("#collapseButton");
const fullscreenButton = document.querySelector("#fullscreenButton");
const messageInput = document.querySelector("#messageInput");
const sendButton = document.querySelector("#sendButton");
const chatForm = document.querySelector("#chatForm");
const conversation = document.querySelector("#conversation");
const chatBody = document.querySelector("#chatBody");
const footerContactPrompt = document.querySelector("#footerContactPrompt");
const footerContactButton = document.querySelector("#footerContactButton");
const footerContactDismiss = document.querySelector("#footerContactDismiss");
const suggestions = document.querySelectorAll(".suggestion");
const homePage = document.querySelector("#homePage");
const recommendPage = document.querySelector("#recommendPage");
const recommendBackButton = document.querySelector("#recommendBackButton");
const RECOMMEND_CONTACT_PATH = "/recommend-contact";
const embeddedMode = window.parent !== window && new URLSearchParams(window.location.search).get("embed") === "1";
const embedParentOrigin = document.referrer ? new URL(document.referrer).origin : window.location.origin;
let recommendationReturnFocus = null;
if (embeddedMode) document.body.classList.add("embedded-mode");

function notifyEmbedParent(type, payload = {}) {
	if (embeddedMode) window.parent.postMessage({ type, ...payload }, embedParentOrigin);
}

function syncPageWithLocation() {
	const showingRecommendation = window.location.pathname === RECOMMEND_CONTACT_PATH;
	homePage.hidden = showingRecommendation;
	homePage.inert = showingRecommendation;
	recommendPage.hidden = !showingRecommendation;
}

function openContactRecommendation() {
	recommendationReturnFocus = document.activeElement;
	window.history.pushState({ view: "recommend-contact", source: "chat" }, "", RECOMMEND_CONTACT_PATH);
	syncPageWithLocation();
	recommendBackButton.focus();
}

function returnToChat() {
	if (window.history.state?.source === "chat") {
		window.history.back();
		return;
	}
	window.history.replaceState({ view: "home" }, "", "/");
	syncPageWithLocation();
}

window.addEventListener("popstate", () => {
	syncPageWithLocation();
	if (window.location.pathname === RECOMMEND_CONTACT_PATH) {
		recommendBackButton.focus();
	} else if (recommendationReturnFocus?.isConnected) {
		recommendationReturnFocus.focus();
	}
});

if (window.location.pathname === RECOMMEND_CONTACT_PATH) {
	window.history.replaceState({ view: "recommend-contact", source: "direct" }, "", RECOMMEND_CONTACT_PATH);
}
syncPageWithLocation();

function appendInlineContent(parent, text) {
	const tokenPattern = /(\*\*\*[^*]+\*\*\*|\*_([^_\n]+?)_\*?|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|`[^`]+`|(?<!\*)\*[^*\s](?:[^*]*?[^*\s])?\*(?!\*)|(?<!_)_[^_\s](?:[^_]*?[^_\s])?_(?!_)|(?:[A-Za-z0-9⌘⌥⇧⌃]{1,12}\s*(?:\+|→|->)\s*)+[A-Za-z0-9⌘⌥⇧⌃]{1,12})/g;
	let previousIndex = 0;

	for (const match of text.matchAll(tokenPattern)) {
		if (match.index > previousIndex) parent.append(document.createTextNode(text.slice(previousIndex, match.index)));

		const token = match[0];
		if (token.startsWith("*_")) {
			const emphasis = document.createElement("strong");
			const italic = document.createElement("em");
			italic.textContent = token.slice(2, token.endsWith("_*") ? -2 : -1);
			emphasis.append(italic);
			parent.append(emphasis);
		} else if (token.startsWith("***")) {
			const emphasis = document.createElement("strong");
			const italic = document.createElement("em");
			italic.textContent = token.slice(3, -3);
			emphasis.append(italic);
			parent.append(emphasis);
		} else if (token.startsWith("**") || token.startsWith("__")) {
			const emphasis = document.createElement("strong");
			emphasis.textContent = token.slice(2, -2);
			parent.append(emphasis);
		} else if (token.startsWith("~~")) {
			const deletion = document.createElement("del");
			deletion.textContent = token.slice(2, -2);
			parent.append(deletion);
		} else if (token.startsWith("*") || token.startsWith("_")) {
			const emphasis = document.createElement("em");
			emphasis.textContent = token.slice(1, -1);
			parent.append(emphasis);
		} else if (token.startsWith("`")) {
			const code = document.createElement("code");
			const codeText = token.slice(1, -1);
			code.textContent = codeText;
			if (/[+→⇧⌘⌥⌃]/.test(codeText)) code.classList.add("response-combo");
			parent.append(code);
		} else {
			const combination = document.createElement("code");
			combination.className = "response-combo";
			combination.textContent = token;
			parent.append(combination);
		}
		previousIndex = match.index + token.length;
	}

	if (previousIndex < text.length) parent.append(document.createTextNode(text.slice(previousIndex)));
}

function renderAssistantReply(bubble, text) {
	const content = document.createElement("div");
	content.className = "response-content";
	let paragraph = [];
	let list = null;
	const normalizedText = text
		.replace(/(?<=\S)(?=#{1,3}\s)(?<!#)/g, "\n")
		.replace(/^(#{1,3}\s+.+?)-\s+(?=[A-Z])/gm, "$1\n- ")
		.replace(/^([A-Z][A-Za-z ]+?)\s*-\s+(?=[A-Z][^:\n]{1,80}:)/, "### $1\n- ")
		.replace(/([:;.!?])\s*\*\s+(?=[A-Z])/g, "$1\n- ")
		.replace(/([.!?])\s*-\s+(?=[A-Z][^:\n]{1,80}:)/g, "$1\n- ")
		.replace(/([.!?])(?=[A-Z][^:\n]{1,60}:)/g, "$1\n")
		.replace(/:(?=(?:\*\*|__)[A-Z])/g, ": ")
		.replace(/([.!?])(?=\*[^*\n]+\*$)/gm, "$1\n");

	const flushParagraph = () => {
		if (!paragraph.length) return;
		const element = document.createElement("p");
		appendInlineContent(element, paragraph.join(" "));
		content.append(element);
		paragraph = [];
	};
	const flushList = () => {
		if (!list) return;
		content.append(list);
		list = null;
	};

	for (const line of normalizedText.split(/\r?\n/)) {
		const trimmed = line.trim();
		const listMatch = trimmed.match(/^(?:[-*]\s+|\d+[.)]\s+)(.*)$/);
		const headingMatch = trimmed.match(/^#{1,3}\s+(.+?)(?:\s+#+)?\s*$/);
		if (!trimmed) {
			flushParagraph();
			flushList();
		} else if (listMatch) {
			flushParagraph();
			const ordered = /^\d/.test(trimmed);
			if (!list || (list.tagName === "OL") !== ordered) {
				flushList();
				list = document.createElement(ordered ? "ol" : "ul");
			}
			const item = document.createElement("li");
			appendInlineContent(item, listMatch[1]);
			list.append(item);
		} else {
			flushList();
			if (headingMatch) {
				flushParagraph();
				const heading = document.createElement("h3");
				appendInlineContent(heading, headingMatch[1]);
				content.append(heading);
			} else {
				paragraph.push(trimmed);
			}
		}
	}
	flushParagraph();
	flushList();
	bubble.replaceChildren(content);
}

function getOrCreateId(storage, key) {
	let identifier = storage.getItem(key);
	if (!identifier) {
		const randomBytes = new Uint8Array(16);
		window.crypto.getRandomValues(randomBytes);
		identifier = Array.from(randomBytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
		storage.setItem(key, identifier);
	}
	return identifier;
}

const userId = getOrCreateId(window.localStorage, "cartogoAnonymousUserId");
const sessionId = getOrCreateId(window.sessionStorage, "cartogoChatSessionId");

function openChat() {
	launcher.hidden = true;
	chatWindow.hidden = false;
	messageInput.focus();
}

function closeChat() {
	chatWindow.classList.add("is-closing");
}

function showFooterContactPrompt() {
	footerContactPrompt.hidden = false;
	footerContactPrompt.classList.remove("is-appearing");
	window.requestAnimationFrame(() => footerContactPrompt.classList.add("is-appearing"));
}

launcher.addEventListener("click", openChat);
if (embeddedMode) openChat();
collapseButton.addEventListener("click", () => {
	if (embeddedMode) {
		notifyEmbedParent("cartogo-chat-close");
		return;
	}
	showFooterContactPrompt();
	closeChat();
});
fullscreenButton.addEventListener("click", () => {
	showFooterContactPrompt();
	const isFullscreen = chatWindow.classList.toggle("is-fullscreen");
	notifyEmbedParent("cartogo-chat-fullscreen", { enabled: isFullscreen });
	fullscreenButton.classList.toggle("is-fullscreen-control", isFullscreen);
	fullscreenButton.setAttribute("aria-label", isFullscreen ? "Exit fullscreen" : "Expand chat to fullscreen");
	fullscreenButton.setAttribute("aria-pressed", String(isFullscreen));
	fullscreenButton.title = isFullscreen ? "Exit fullscreen" : "Expand";
});

chatWindow.addEventListener("animationend", (event) => {
	if (event.animationName !== "panel-out") return;
	chatWindow.hidden = true;
	launcher.hidden = false;
	chatWindow.classList.remove("is-closing", "is-fullscreen");
	fullscreenButton.classList.remove("is-fullscreen-control");
	fullscreenButton.setAttribute("aria-label", "Expand chat to fullscreen");
	fullscreenButton.setAttribute("aria-pressed", "false");
	fullscreenButton.title = "Expand";
	launcher.focus();
});

document.addEventListener("click", (event) => {
	const button = event.target.closest("button");
	if (!button || button.disabled) return;
	button.classList.remove("is-clicked");
	void button.offsetWidth;
	button.classList.add("is-clicked");
	window.setTimeout(() => button.classList.remove("is-clicked"), 450);
});

suggestions.forEach((button) => {
	button.addEventListener("click", () => {
		messageInput.value = button.dataset.prompt;
		sendButton.disabled = false;
		messageInput.focus();
	});
});

messageInput.addEventListener("input", () => {
	sendButton.disabled = messageInput.value.trim().length === 0;
});

chatForm.addEventListener("submit", (event) => {
	event.preventDefault();
	const text = messageInput.value.trim();
	if (!text) return;

	const messages = [];
	const conversationItems = Array.from(conversation.children);
	for (let index = 0; index + 1 < conversationItems.length; index += 2) {
		const userTurn = conversationItems[index];
		const assistantTurn = conversationItems[index + 1];
		if (!userTurn.classList.contains("user-message") || !assistantTurn.classList.contains("assistant-message") || assistantTurn.classList.contains("is-error")) continue;
		messages.push({ role: "user", text: userTurn.textContent.trim() });
		messages.push({ role: "assistant", text: assistantTurn.querySelector(".message-bubble").textContent.trim() });
	}
	messages.splice(10);
	messages.push({ role: "user", text });

	const userMessage = document.createElement("div");
	userMessage.className = "user-message";
	userMessage.textContent = text;
	conversation.append(userMessage);
	notifyEmbedParent("cartogo-chat-message", { sessionId, role: "user", content: text, createdAt: new Date().toISOString() });
	messageInput.value = "";
	messageInput.disabled = true;
	sendButton.disabled = true;
	suggestions.forEach((button) => { button.disabled = true; });

	const response = document.createElement("div");
	response.className = "assistant-message";
	response.classList.add("is-thinking");
	response.innerHTML = '<span class="mini-avatar" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M4.75 5.75h14.5v10.5H11l-5.5 3v-3H4.75V5.75Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M8 10h8M8 13h5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></span><div class="message-stack"><div class="message-meta"><strong>Cartogo assistant</strong><span>Just now</span></div><div class="message-bubble"><p>Thinking...</p></div></div>';
	conversation.append(response);
	chatBody.scrollTop = chatBody.scrollHeight;

	fetch("/api/chat", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"X-Session-ID": sessionId,
			"X-User-ID": userId,
		},
		body: JSON.stringify({ messages }),
	})
		.then(async (result) => {
			const payload = await result.json();
			if (!result.ok) throw new Error(payload.error || "Amazon Bedrock request failed.");
			renderAssistantReply(response.querySelector(".message-bubble"), payload.reply);
			notifyEmbedParent("cartogo-chat-message", { sessionId, role: "assistant", content: payload.reply, createdAt: new Date().toISOString() });
			response.classList.remove("is-thinking");
		})
		.catch((error) => {
			const errorMessage = error.message || "Could not reach the local chat server.";
			renderAssistantReply(response.querySelector(".message-bubble"), errorMessage);
			notifyEmbedParent("cartogo-chat-message", { sessionId, role: "assistant", content: errorMessage, createdAt: new Date().toISOString() });
			response.classList.remove("is-thinking");
			response.classList.add("is-error");
		})
		.finally(() => {
			messageInput.disabled = false;
			sendButton.disabled = messageInput.value.trim().length === 0;
			suggestions.forEach((button) => { button.disabled = false; });
			messageInput.focus();
			chatBody.scrollTop = chatBody.scrollHeight;
		});
});

recommendBackButton.addEventListener("click", returnToChat);
footerContactButton.addEventListener("click", openContactRecommendation);
footerContactDismiss.addEventListener("click", () => {
	footerContactPrompt.hidden = true;
	footerContactPrompt.classList.remove("is-appearing");
});
