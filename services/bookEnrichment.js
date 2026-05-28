const { Book } = require("../config");
const { callLlmForJson, safeJsonParse } = require("./llm");

const ENRICHABLE_FIELDS = ["pages", "publishedYear", "description"];

function isInvalidNumber(value) {
    if (value === null || value === undefined || value === "") return true;
    const n = Number(value);
    if (!Number.isFinite(n)) return true;
    return n <= 1;
}

function isInvalidDescription(value) {
    if (value === null || value === undefined) return true;
    const s = String(value).trim();
    if (!s) return true;
    return s.length < 10;
}

function detectMissingFields(book) {
    const missing = [];
    const pages = book.num_pages != null ? book.num_pages : book.pageCount;
    if (isInvalidNumber(pages)) missing.push("pages");
    if (isInvalidNumber(book.published_year)) missing.push("publishedYear");
    if (isInvalidDescription(book.description)) missing.push("description");
    return missing;
}

function buildEnrichmentPrompt(book, missingFields) {
    const pages = book.num_pages != null ? book.num_pages : book.pageCount;
    return [
        "You are a book database assistant. Given the following book information, fill in ONLY the missing or clearly incorrect fields.",
        "",
        `Book title: "${book.title || ""}"`,
        `Author: "${book.authors || ""}"`,
        `Current pages: ${pages == null ? "" : pages} (invalid if <= 1)`,
        `Current published year: ${book.published_year == null ? "" : book.published_year} (invalid if <= 1)`,
        `Current description: "${(book.description || "").replace(/"/g, '\\"')}" (invalid if empty)`,
        "",
        `Fields that need enrichment: ${missingFields.join(", ")}`,
        "",
        'Respond ONLY with a valid JSON object containing the corrected values for the listed fields. No explanation, no markdown, just JSON.',
        'Use exactly these key names where applicable: "pages" (integer), "publishedYear" (integer), "description" (string, 1-3 sentences).',
        "If you do not know a value with reasonable confidence, omit that key (do not guess wildly).",
    ].join("\n");
}

/**
 * Fills missing `pages`, `published_year`, or `description` via LLM and persists on the Book.
 * @param {object} bookInput Book document or `{ _id, title, authors, ... }`
 * @returns {Promise<object>} updated book fields applied
 */
async function enrichBookData(bookInput) {
    if (!bookInput || !bookInput._id) {
        throw new Error("enrichBookData: book._id is required");
    }

    const book = await Book.findById(bookInput._id);
    if (!book) {
        throw new Error(`Book not found: ${bookInput._id}`);
    }

    const missingFields = detectMissingFields(book);
    if (!missingFields.length) {
        return {
            book: book.toObject(),
            updatedFields: [],
            missingFields: [],
            alreadyComplete: true,
            source: null,
        };
    }

    const prompt = buildEnrichmentPrompt(book, missingFields);
    console.log(`[enrichment] book=${book._id} missing=${missingFields.join(",")} → calling LLM…`);

    const { text, source } = await callLlmForJson(prompt);
    const parsed = safeJsonParse(text, {}) || {};
    console.log(`[enrichment] book=${book._id} source=${source} parsed=${JSON.stringify(parsed)}`);

    const updates = {};
    const updatedFields = [];

    if (missingFields.includes("pages") && parsed.pages != null) {
        const n = Number(parsed.pages);
        if (Number.isFinite(n) && n > 1 && n < 100000) {
            updates.num_pages = Math.round(n);
            updates.pageCount = Math.round(n);
            updatedFields.push("pages");
        }
    }
    if (missingFields.includes("publishedYear") && parsed.publishedYear != null) {
        const n = Number(parsed.publishedYear);
        const currentYear = new Date().getFullYear();
        if (Number.isFinite(n) && n > 1 && n <= currentYear + 1) {
            updates.published_year = Math.round(n);
            updatedFields.push("publishedYear");
        }
    }
    if (missingFields.includes("description") && typeof parsed.description === "string") {
        const d = parsed.description.trim();
        if (d.length >= 10) {
            updates.description = d;
            updatedFields.push("description");
        }
    }

    if (!updatedFields.length) {
        console.warn(`[enrichment] book=${book._id} LLM returned no acceptable values for ${missingFields.join(",")}`);
        return {
            book: book.toObject(),
            updatedFields,
            missingFields,
            alreadyComplete: false,
            source,
        };
    }

    book.set(updates);
    for (const path of Object.keys(updates)) {
        book.markModified(path);
    }
    await book.save();
    console.log(`[enrichment] book=${book._id} saved fields=${updatedFields.join(",")}`);

    const verified = await Book.findById(book._id).lean();
    return {
        book: verified || book.toObject(),
        updatedFields,
        missingFields,
        alreadyComplete: false,
        source,
    };
}

module.exports = {
    enrichBookData,
    detectMissingFields,
    ENRICHABLE_FIELDS,
};
