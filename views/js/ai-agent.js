/**
 * Floating chat widget: localStorage history, POST /api/ai/chat (or AI_CHAT_API_BASE + path).
 * Assistant HTML is escaped then light Markdown (**bold**, lists); copy uses raw text.
 */
(() => {
  const STORAGE_KEY = "aiAgentChat_v1";
  const WELCOME_TEXT =
    "Hi! I’m your AI book assistant. I can help you find, collect, and choose books based on your interests and preferences.";

  /** @param {string} id */
  function qs(id) {
    return document.getElementById(id);
  }

  /** @returns {{role: string, content: string}[]} */
  function loadHistory() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  /** Keeps last 30 turns; silent no-op if storage is full or disabled. */
  function saveHistory(history) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(-30)));
    } catch {
      // ignore
    }
  }

  function scrollToBottom(scrollEl) {
    if (!scrollEl) return;
    scrollEl.scrollTop = scrollEl.scrollHeight;
  }

  /** Escapes HTML so assistant output can be rendered as innerHTML without XSS. */
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /** Splits inline `* item * item` (common LLM glitch) into separate lines before list detection. */
  function normalizeLooseListMarkers(text) {
    return String(text || "")
      .replace(/\s+\*\s+/g, "\n* ")
      .replace(/\s+-\s+(?=[A-Za-zА-Яа-яІіЇїЄєҐґ"«])/g, "\n- ");
  }

  /**
   * Subset Markdown → safe HTML: **bold**, lines starting with `-` or `*`, paragraphs, <br>.
   * @param {string} raw Plain assistant reply (stored in history as-is).
   * @returns {string} HTML fragment (no outer wrapper).
   */
  function assistantMarkdownToSafeHtml(raw) {
    let t = normalizeLooseListMarkers(raw);
    t = escapeHtml(t);
    t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

    const blocks = t.split(/\n\n+/);
    const parts = [];
    for (const block of blocks) {
      const trimmed = block.trim();
      if (!trimmed) continue;
      const lines = trimmed.split("\n").map((l) => l.trim()).filter(Boolean);
      const isList = lines.every((l) => /^\*\s+/.test(l) || /^-\s+/.test(l));
      if (isList && lines.length) {
        const items = lines.map((l) =>
          l.replace(/^\*\s+/, "").replace(/^-\s+/, "")
        );
        parts.push(
          "<ul>" + items.map((i) => "<li>" + i + "</li>").join("") + "</ul>"
        );
      } else {
        parts.push("<p>" + trimmed.split("\n").join("<br>") + "</p>");
      }
    }
    return parts.length ? parts.join("") : "<p></p>";
  }

  /**
   * @param {"user"|"assistant"} role
   * @param {string} content Plain text (assistant gets HTML via assistantMarkdownToSafeHtml).
   */
  function renderMessageRow(role, content) {
    const row = document.createElement("div");
    row.className = `ai-bubble-row ${role === "user" ? "user" : "assistant"}`;

    const bubble = document.createElement("div");
    bubble.className = `ai-bubble ${role === "user" ? "user" : "assistant"}`;
    if (role === "assistant") {
      bubble.classList.add("ai-md");
      bubble.innerHTML = assistantMarkdownToSafeHtml(content);
    } else {
      bubble.textContent = content;
    }

    row.appendChild(bubble);

    if (role === "assistant") {
      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "ai-copy";
      copyBtn.setAttribute("aria-label", "Copy");
      copyBtn.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
        '<path d="M9 9h10v12H9V9Z" stroke="#212529" stroke-width="2" stroke-linejoin="round"/>' +
        '<path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" stroke="#212529" stroke-width="2" stroke-linecap="round"/>' +
        "</svg>";
      copyBtn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(content);
        } catch {
          // ignore
        }
      });
      row.appendChild(copyBtn);
    }

    return row;
  }

  /**
   * Flat string for storage/UI: server `reply` plus optional Semantic:/ML: lists when the API sends `recommendations`.
   * Skips appending if the model already mentioned "Recommendations:".
   */
  function formatAssistantMessage(data) {
    let text = typeof data.reply === "string" ? data.reply : "";
    const rec = data.recommendations;
    if (rec && typeof rec === "object" && text && !text.includes("Recommendations:")) {
      const sem = rec.semantic;
      const ml = rec.ml;
      const lines = [];
      if (Array.isArray(sem) && sem.length) {
        lines.push("Semantic:", ...sem.slice(0, 5).map((x) => "• " + (x.title || "")));
      }
      if (Array.isArray(ml) && ml.length) {
        lines.push("ML:", ...ml.slice(0, 5).map((x) => "• " + (x.title || "")));
      }
      if (lines.length) text += "\n\n" + lines.join("\n");
    }
    return text.trim();
  }

  /** Relative `/api/ai/chat` unless `window.AI_CHAT_API_BASE` is set (e.g. another origin). */
  function chatApiUrl() {
    const base =
      typeof window !== "undefined" && window.AI_CHAT_API_BASE
        ? String(window.AI_CHAT_API_BASE).replace(/\/$/, "")
        : "";
    return `${base}/api/ai/chat`;
  }

  /**
   * @param {string} message
   * @param {{role: string, content: string}[]} history
   * @returns {Promise<string>} Plain-text assistant reply (with optional recommendation lines)
   */
  async function sendToServer(message, history) {
    const res = await fetch(chatApiUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, history }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data && data.error ? data.error : `Request failed (${res.status})`;
      throw new Error(msg);
    }
    if (!data || typeof data.reply !== "string") {
      throw new Error("Invalid response from server");
    }
    return formatAssistantMessage(data);
  }

  document.addEventListener("DOMContentLoaded", () => {
    const scrollEl = qs("aiAgentScroll");
    const welcomeTextEl = qs("aiAgentWelcomeText");
    const messagesEl = qs("aiAgentMessages");
    const typingEl = qs("aiAgentTyping");
    const formEl = qs("aiAgentForm");
    const inputEl = qs("aiAgentInput");
    const sendBtn = qs("aiAgentSendBtn");
    const statusEl = qs("aiAgentStatus");
    const resetBtn = qs("aiAgentResetBtn");

    if (
      !scrollEl ||
      !welcomeTextEl ||
      !messagesEl ||
      !typingEl ||
      !formEl ||
      !inputEl ||
      !sendBtn ||
      !statusEl ||
      !resetBtn
    )
      return;

    let history = loadHistory();

    const agentRoot = formEl.closest(".ai-agent-root");

    function showTyping(show) {
      typingEl.style.display = show ? "block" : "none";
      typingEl.setAttribute("aria-hidden", show ? "false" : "true");
      if (show) scrollToBottom(scrollEl);
    }

    /** Toggles CSS/ARIA while waiting for the chat API (typing row + header/input animations). */
    function setThinkingUi(busy) {
      if (!agentRoot) return;
      agentRoot.classList.toggle("ai-is-thinking", !!busy);
      agentRoot.setAttribute("aria-busy", busy ? "true" : "false");
    }

    function setBusy(busy, text) {
      sendBtn.disabled = busy;
      inputEl.disabled = busy;
      statusEl.textContent = text || "";
      setThinkingUi(busy);
      showTyping(busy);
    }

    function renderAll() {
      welcomeTextEl.textContent = WELCOME_TEXT;
      messagesEl.innerHTML = "";
      for (const m of history) {
        messagesEl.appendChild(renderMessageRow(m.role, m.content));
      }
      scrollToBottom(scrollEl);
    }

    function resetChat() {
      history = [];
      saveHistory(history);
      renderAll();
      statusEl.textContent = "";
      setThinkingUi(false);
      showTyping(false);
    }

    renderAll();

    resetBtn.addEventListener("click", resetChat);

    formEl.addEventListener("submit", async (e) => {
      e.preventDefault();
      const message = String(inputEl.value || "").trim();
      if (!message) return;

      history.push({ role: "user", content: message });
      saveHistory(history);
      messagesEl.appendChild(renderMessageRow("user", message));
      scrollToBottom(scrollEl);
      inputEl.value = "";

      setBusy(true, "Thinking…");
      try {
        const reply = await sendToServer(message, history);
        history.push({ role: "assistant", content: reply });
        saveHistory(history);
        setBusy(false, "");
        messagesEl.appendChild(renderMessageRow("assistant", reply));
        scrollToBottom(scrollEl);
        setBusy(false, "");
        inputEl.focus();
      } catch (err) {
        const msg = err && err.message ? err.message : "Failed to send message";
        messagesEl.appendChild(renderMessageRow("assistant", `Sorry — ${msg}`));
        scrollToBottom(scrollEl);
        setBusy(false, "");
      }
    });

    const modalEl = qs("aiAgentModal");
    if (modalEl && window.bootstrap) {
      modalEl.addEventListener("shown.bs.modal", () => {
        inputEl.focus();
        scrollToBottom(scrollEl);
      });
    }
  });
})();


