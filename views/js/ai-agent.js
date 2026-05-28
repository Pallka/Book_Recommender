/** Chat widget: history in localStorage; optional `window.AI_CHAT_API_BASE` for API origin. */
(() => {
  const STORAGE_KEY = "aiAgentChat_v1";
  let attachAssistantFeedback = () => {};

  const WELCOME_TEXT =
    "Hi! I’m your AI book assistant. I can help you find, collect, and choose books based on your interests and preferences.";

  function qs(id) {
    return document.getElementById(id);
  }

  function loadHistory() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

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

  function currentBookFromPage() {
    const b = typeof window !== "undefined" ? window.AI_CURRENT_BOOK : null;
    if (!b || !b._id || !b.title) return null;
    return {
      _id: String(b._id),
      title: String(b.title),
      authors: b.authors ? String(b.authors) : "",
      thumbnail: b.thumbnail ? String(b.thumbnail) : "/images/no-cover.svg",
      url: b.url ? String(b.url) : "/books/" + encodeURIComponent(String(b._id)),
    };
  }

  function normalizeForMatch(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function includesBookCard(books, book) {
    if (!Array.isArray(books) || !book) return false;
    return books.some((b) => b && String(b._id) === String(book._id));
  }

  function shouldAttachCurrentBook(replyText, currentBook) {
    if (!currentBook || !currentBook.title) return false;
    const reply = normalizeForMatch(replyText);
    const title = normalizeForMatch(currentBook.title);
    if (!reply || !title) return false;
    return reply.includes(title);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function normalizeLooseListMarkers(text) {
    return String(text || "")
      .replace(/\s+\*\s+/g, "\n* ")
      .replace(/\s+-\s+(?=[A-Za-zА-Яа-яІіЇїЄєҐґ"«])/g, "\n- ");
  }

  /**
   * Removes Markdown markers before HTML rendering (headings, bold, inline code).
   * @param {string} raw assistant reply text
   * @returns {string} plain text safe for `assistantMarkdownToSafeHtml`
   */
  function stripAssistantMarkdown(raw) {
    let t = String(raw || "");
    t = t.replace(/^#{1,6}\s+/gm, "");
    t = t.replace(/\*\*([^*]+)\*\*/g, "$1");
    t = t.replace(/__([^_]+)__/g, "$1");
    t = t.replace(/`([^`]+)`/g, "$1");
    t = t.replace(/^[-*_]{3,}\s*$/gm, "");
    return t;
  }

  function assistantMarkdownToSafeHtml(raw) {
    let t = stripAssistantMarkdown(normalizeLooseListMarkers(raw));
    t = escapeHtml(t);

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

  function renderBookCards(books) {
    if (!Array.isArray(books) || !books.length) return null;
    const wrap = document.createElement("div");
    wrap.className = "ai-book-cards";

    const fallbackThumb = "/images/no-cover.svg";
    for (const b of books) {
      if (!b || !b._id || !b.title) continue;
      const link = document.createElement("a");
      link.className = "ai-book-card";
      link.href = b.url || ("/books/" + encodeURIComponent(String(b._id)));
      link.target = "_self";
      link.setAttribute("aria-label", "Open book details: " + b.title);

      const thumbWrap = document.createElement("div");
      thumbWrap.className = "ai-book-card-thumb";
      const img = document.createElement("img");
      const thumb = b.thumbnail && String(b.thumbnail).trim();
      const isPlaceholder =
        !thumb ||
        thumb === fallbackThumb ||
        thumb === "/images/default-book.jpg";
      img.alt = b.title;
      img.loading = "lazy";
      img.decoding = "async";
      if (isPlaceholder) {
        img.src = "/images/book.svg";
        img.classList.add("ai-book-card-thumb-fallback");
      } else {
        img.src = thumb;
      }
      img.addEventListener(
        "error",
        () => {
          img.src = "/images/book.svg";
          img.classList.add("ai-book-card-thumb-fallback");
        },
        { once: true }
      );
      thumbWrap.appendChild(img);

      const body = document.createElement("div");
      body.className = "ai-book-card-body";

      const title = document.createElement("div");
      title.className = "ai-book-card-title";
      title.textContent = b.title;
      body.appendChild(title);

      const cta = document.createElement("div");
      cta.className = "ai-book-card-cta";
      cta.innerHTML =
        '<svg class="ai-book-card-cta-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
        '<path d="M13.9841 6.01195C13.9841 3.79695 12.2051 2.00195 10.0111 2.00195C7.81711 2.00195 6.03711 3.79695 6.03711 6.01195" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
        '<path d="M9.37592 21.9929L9.27192 20.8969C8.78392 18.8789 8.11792 18.6129 7.03292 17.1669C6.54292 16.5149 5.51992 15.5899 4.68292 14.3399C4.12592 13.5079 4.86992 11.6149 6.56592 12.1919C6.84792 12.2879 7.08592 12.4809 7.29592 12.6919L8.94192 14.3459C8.92892 12.0079 8.95892 7.24888 8.92192 5.78888C8.88592 4.32888 11.4199 3.85888 11.5699 5.85488V10.3469M11.5699 10.3469V11.2119M11.5699 10.3469C12.3979 9.24888 13.9659 9.20988 14.1949 11.0479M14.1949 11.0479C14.2319 11.3479 14.2349 11.6979 14.1949 12.1009M14.1949 11.0479C14.6129 9.76388 16.4529 10.2739 16.8189 11.7679C16.9049 12.1229 16.8189 12.5329 16.8539 13.0059M16.8189 11.7689C17.0559 11.0489 19.6839 10.9949 19.4349 13.7779L19.4999 16.3019C19.3999 17.8089 19.1779 18.4399 18.6369 19.1689C18.3569 19.5459 17.9879 19.8789 17.8469 20.3279C17.7299 20.7039 17.6549 21.2549 17.7369 21.9999" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
        "</svg>" +
        "<span>Click here to explore more information about book</span>";
      body.appendChild(cta);

      link.appendChild(thumbWrap);
      link.appendChild(body);
      wrap.appendChild(link);
    }
    return wrap.children.length ? wrap : null;
  }

  function renderMessageRow(role, content, books, opts = {}) {
    const row = document.createElement("div");
    row.className = `ai-bubble-row ${role === "user" ? "user" : "assistant"}`;

    const bubble = document.createElement("div");
    bubble.className = `ai-bubble ${role === "user" ? "user" : "assistant"}`;
    if (role === "assistant") {
      bubble.classList.add("ai-md");
      bubble.innerHTML = assistantMarkdownToSafeHtml(content);

      const cards = renderBookCards(books);
      if (cards) bubble.appendChild(cards);
    } else {
      bubble.textContent = content;
    }

    row.appendChild(bubble);

    if (role === "assistant") {
      const interactionId =
        opts && typeof opts.interactionId === "string" && opts.interactionId.trim()
          ? opts.interactionId.trim()
          : "";
      if (interactionId) {
        row.dataset.interactionId = interactionId;
      }

      const side = document.createElement("div");
      side.className = "ai-assistant-side";

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
      side.appendChild(copyBtn);

      if (interactionId) {
        const likeBtn = document.createElement("button");
        likeBtn.type = "button";
        likeBtn.className = "ai-feedback ai-feedback-like";
        likeBtn.setAttribute("aria-label", "Like this answer");
        const likeImg = document.createElement("img");
        likeImg.src = "/images/mdi_heart.svg";
        likeImg.alt = "";
        likeBtn.appendChild(likeImg);

        const dislikeBtn = document.createElement("button");
        dislikeBtn.type = "button";
        dislikeBtn.className = "ai-feedback ai-feedback-dislike";
        dislikeBtn.setAttribute("aria-label", "Dislike this answer");
        const dislikeImg = document.createElement("img");
        dislikeImg.src = "/images/ic_outline-heart-broken.svg";
        dislikeImg.alt = "";
        dislikeBtn.appendChild(dislikeImg);

        side.appendChild(likeBtn);
        side.appendChild(dislikeBtn);
      }

      row.appendChild(side);
    }

    return row;
  }

  /**
   * Normalizes `/api/ai/chat` JSON into bubble text, book cards, and interaction id.
   * @param {object} data server response body
   * @returns {{ text: string, books: object[], interactionId: string|null }}
   */
  function formatAssistantMessage(data) {
    const text = (typeof data.reply === "string" ? data.reply : "").trim();
    const books = Array.isArray(data && data.books)
      ? data.books.filter(
          (b) => b && b._id && typeof b.title === "string" && b.title.trim()
        )
      : [];
    const currentBook = currentBookFromPage();
    if (
      currentBook &&
      shouldAttachCurrentBook(text, currentBook) &&
      !includesBookCard(books, currentBook)
    ) {
      books.unshift(currentBook);
    }
    const interactionId =
      data && typeof data.interactionId === "string" && data.interactionId.trim()
        ? data.interactionId.trim()
        : null;
    return { text, books, interactionId };
  }

  function chatApiUrl() {
    const base =
      typeof window !== "undefined" && window.AI_CHAT_API_BASE
        ? String(window.AI_CHAT_API_BASE).replace(/\/$/, "")
        : "";
    return `${base}/api/ai/chat`;
  }

  function feedbackApiUrl() {
    const base =
      typeof window !== "undefined" && window.AI_CHAT_API_BASE
        ? String(window.AI_CHAT_API_BASE).replace(/\/$/, "")
        : "";
    return `${base}/api/ai/feedback`;
  }

  /**
   * Posts a user turn to Node chat API (proxies to ai-service or LLM fallback).
   * @param {string} message trimmed user text
   * @param {object[]} history prior `{ role, content }` turns
   * @returns {Promise<{ text: string, books: object[], interactionId: string|null }>}
   */
  async function sendToServer(message, history) {
    const res = await fetch(chatApiUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        history,
        current_book: currentBookFromPage(),
      }),
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

    attachAssistantFeedback = function attachAssistantFeedback(row) {
      const interactionId = row.dataset && row.dataset.interactionId;
      if (!interactionId || row.dataset.feedbackBound === "1") return;
      const likeBtn = row.querySelector(".ai-feedback-like");
      const dislikeBtn = row.querySelector(".ai-feedback-dislike");
      if (!likeBtn || !dislikeBtn) return;
      row.dataset.feedbackBound = "1";

      function syncVisual() {
        const entry = history.find(
          (h) => h.role === "assistant" && h.interactionId === interactionId
        );
        const v = entry && entry.feedback ? entry.feedback : "";
        likeBtn.classList.toggle("is-selected", v === "like");
        dislikeBtn.classList.toggle("is-selected", v === "dislike");
      }
      syncVisual();

      async function postFeedback(rating) {
        likeBtn.disabled = true;
        dislikeBtn.disabled = true;
        try {
          const res = await fetch(feedbackApiUrl(), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ interactionId, rating }),
          });
          if (!res.ok) return;
          const entry = history.find(
            (h) => h.role === "assistant" && h.interactionId === interactionId
          );
          if (entry) {
            entry.feedback = rating;
            saveHistory(history);
          }
          syncVisual();
        } catch {
          // ignore
        } finally {
          likeBtn.disabled = false;
          dislikeBtn.disabled = false;
        }
      }

      likeBtn.addEventListener("click", () => postFeedback("like"));
      dislikeBtn.addEventListener("click", () => postFeedback("dislike"));
    };

    function showTyping(show) {
      typingEl.style.display = show ? "block" : "none";
      typingEl.setAttribute("aria-hidden", show ? "false" : "true");
      if (show) scrollToBottom(scrollEl);
    }

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
      const currentBook = currentBookFromPage();
      for (const m of history) {
        let books = Array.isArray(m.books) ? m.books.slice() : [];
        if (
          m.role === "assistant" &&
          currentBook &&
          shouldAttachCurrentBook(m.content, currentBook) &&
          !includesBookCard(books, currentBook)
        ) {
          books.unshift(currentBook);
        }
        const row = renderMessageRow(m.role, m.content, books, {
          interactionId: m.interactionId,
          feedback: m.feedback,
        });
        messagesEl.appendChild(row);
        if (m.role === "assistant") attachAssistantFeedback(row);
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
      messagesEl.appendChild(renderMessageRow("user", message, undefined, {}));
      scrollToBottom(scrollEl);
      inputEl.value = "";

      setBusy(true, "Thinking…");
      try {
        const { text, books, interactionId } = await sendToServer(
          message,
          history.map((m) => ({ role: m.role, content: m.content }))
        );
        const entry = { role: "assistant", content: text };
        if (Array.isArray(books) && books.length) entry.books = books;
        if (interactionId) entry.interactionId = interactionId;
        history.push(entry);
        saveHistory(history);
        setBusy(false, "");
        const row = renderMessageRow("assistant", text, books, {
          interactionId: interactionId || undefined,
        });
        messagesEl.appendChild(row);
        attachAssistantFeedback(row);
        scrollToBottom(scrollEl);
        setBusy(false, "");
        inputEl.focus();
      } catch (err) {
        const msg = err && err.message ? err.message : "Failed to send message";
        messagesEl.appendChild(
          renderMessageRow("assistant", `Sorry — ${msg}`, undefined, {})
        );
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


