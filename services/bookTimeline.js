const { Book } = require("../config");
const { callLlmForJson, safeJsonParse } = require("./llm");

const MIN_EVENTS = 5;
const MAX_EVENTS = 10;

const TIMELINE_PROMPT_VERSION = 2;

function isUsableTimeline(value) {
    return Array.isArray(value) && value.length >= MIN_EVENTS;
}

function buildTimelinePrompt(book) {
    const title = book.title || "";
    const author = book.authors || "";
    const year = book.published_year || "";
    const categories = Array.isArray(book.categories)
        ? book.categories.join(", ")
        : (book.categories || "");
    const description = (book.description || "").slice(0, 800);

    return [
        "You are a meticulous historical research assistant. Your task is to generate a historically accurate and tightly relevant historical context for the given book.",
        "",
        "Book info:",
        `- Title: "${title}"`,
        `- Author: "${author}"`,
        `- Publication year: ${year}`,
        `- Categories: ${categories}`,
        `- Description: ${description}`,
        "",
        "STRICT REQUIREMENTS:",
        "1. Include ONLY real historical events with verified, well-documented dates. If you are uncertain about a date or fact, OMIT the event entirely — do not guess.",
        "2. Every event must be DIRECTLY connected to at least one of:",
        "   • the book's themes,",
        "   • its political or social background,",
        "   • scientific, technological, or cultural movements it engages with,",
        "   • the author's lived historical period and personal context,",
        "   • events explicitly mentioned or alluded to in the description.",
        "3. Reject weak, speculative, generic, or indirect connections (e.g., do NOT include a war on the other side of the world just because it happened in the same decade).",
        "4. Do NOT invent or imply relationships between an event and the book. The 'description' field must explain a CONCRETE, defensible link.",
        "5. Do NOT include events that occurred AFTER the book's publication year, unless that later event is essential to understanding the book's impact or reception.",
        "6. Prefer events from the author's region/country and from the cultural sphere the book belongs to over generic world events.",
        "7. Each event must include:",
        '   • "year"        — a single specific integer year (no ranges, no decades),',
        '   • "title"       — the canonical name of the event (concise, neutral, English),',
        '   • "description" — 1–2 sentences explaining EXACTLY WHY this event is relevant to THIS book (theme, author, place, or movement). Do not retell the event in general terms.',
        "8. Return 5 to 10 of the MOST relevant events, sorted in chronological order (earliest first).",
        "9. Do NOT include the book's own publication as one of the events.",
        "10. If you cannot find at least 5 events that meet these criteria, return as many as you can confidently justify; do not pad with generic events.",
        "",
        "Output format — respond ONLY with a valid JSON array. No markdown, no commentary, no leading/trailing text:",
        '[',
        '  {',
        '    "year": 1815,',
        '    "title": "Battle of Waterloo",',
        '    "description": "Ended the Napoleonic Wars whose social aftermath — economic disruption and shifting class fortunes among the English gentry — directly informs the marriage-market anxieties at the heart of the novel."',
        '  },',
        '  ...',
        ']',
    ].join("\n");
}

function normalizeEvent(raw) {
    if (!raw || typeof raw !== "object") return null;
    const year = Number(raw.year);
    const currentYear = new Date().getFullYear();
    if (!Number.isFinite(year) || year < 1 || year > currentYear + 1) return null;

    const title = typeof raw.title === "string" ? raw.title.trim() : "";
    if (!title || title.length > 160) return null;

    const description = typeof raw.description === "string" ? raw.description.trim() : "";
    return {
        year: Math.round(year),
        title,
        description: description.slice(0, 500),
    };
}

function cleanTimeline(rawArray) {
    if (!Array.isArray(rawArray)) return [];
    const seen = new Set();
    const out = [];
    for (const raw of rawArray) {
        const ev = normalizeEvent(raw);
        if (!ev) continue;
        const key = `${ev.year}::${ev.title.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(ev);
    }
    out.sort((a, b) => a.year - b.year);
    return out.slice(0, MAX_EVENTS);
}

/**
 * Builds or returns cached timeline events for a book (LLM JSON array).
 * @param {object} bookInput Book document or id-shaped object
 * @param {{ force?: boolean }} [options] regenerate when true
 * @returns {Promise<object[]>} normalized timeline events
 */
async function generateBookTimeline(bookInput, options = {}) {
    if (!bookInput || !bookInput._id) {
        throw new Error("generateBookTimeline: book._id is required");
    }
    const force = !!options.force;

    const book = await Book.findById(bookInput._id);
    if (!book) throw new Error(`Book not found: ${bookInput._id}`);

    const cachedVersion = Number(book.timelinePromptVersion) || 0;
    const cacheIsFresh = cachedVersion >= TIMELINE_PROMPT_VERSION;

    if (!force && cacheIsFresh && isUsableTimeline(book.timeline)) {
        const cached = book.timeline.map((ev) => ({
            year: ev.year,
            title: ev.title,
            description: ev.description || "",
        }));
        return {
            timeline: cached,
            cached: true,
            source: null,
            generatedAt: book.timelineGeneratedAt || null,
            promptVersion: cachedVersion,
        };
    }

    const prompt = buildTimelinePrompt(book);
    console.log(`[timeline] book=${book._id} force=${force} → calling LLM…`);

    const { text, source } = await callLlmForJson(prompt, { maxTokens: 1500 });
    const parsed = safeJsonParse(text, []);
    const arrayCandidate = Array.isArray(parsed)
        ? parsed
        : (parsed && (parsed.events || parsed.timeline || parsed.data)) || [];

    const timeline = cleanTimeline(arrayCandidate);
    if (!isUsableTimeline(timeline)) {
        console.warn(`[timeline] book=${book._id} LLM produced too few valid events (${timeline.length}) — not caching`);
        return {
            timeline,
            cached: false,
            source,
            generatedAt: null,
        };
    }

    book.set({
        timeline,
        timelineGeneratedAt: new Date(),
        timelinePromptVersion: TIMELINE_PROMPT_VERSION,
    });
    book.markModified("timeline");
    book.markModified("timelineGeneratedAt");
    book.markModified("timelinePromptVersion");
    await book.save();
    console.log(`[timeline] book=${book._id} saved ${timeline.length} events (source=${source}, v${TIMELINE_PROMPT_VERSION})`);

    return {
        timeline,
        cached: false,
        source,
        generatedAt: book.timelineGeneratedAt,
        promptVersion: TIMELINE_PROMPT_VERSION,
    };
}

module.exports = {
    generateBookTimeline,
    cleanTimeline,
    MIN_EVENTS,
    MAX_EVENTS,
};
