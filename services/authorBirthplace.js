const { Book } = require("../config");
const { callLlmForJson, safeJsonParse } = require("./llm");

const AUTHOR_BIRTHPLACE_VERSION = 1;

const inflight = new Map();

function hasUsableLocation(value) {
    return !!(
        value &&
        value.city &&
        value.country &&
        Number.isFinite(Number(value.latitude)) &&
        Number.isFinite(Number(value.longitude))
    );
}

function pickPrimaryAuthor(authors) {
    if (!authors) return "";
    const first = String(authors).split(/[,;|/]| and /i)[0];
    return (first || "").trim();
}

function buildAuthorBirthplacePrompt(book) {
    const primaryAuthor = pickPrimaryAuthor(book.authors);
    const allAuthors = String(book.authors || "").trim();

    return [
        "You are a biographical research assistant. Determine the birthplace of the primary author of the given book.",
        "",
        "Author info:",
        `- Primary author: "${primaryAuthor}"`,
        `- Full author field: "${allAuthors}"`,
        `- Book title (for disambiguation only): "${book.title || ""}"`,
        `- Publication year (for disambiguation only): ${book.published_year || ""}`,
        "",
        "Requirements:",
        "- Return the city and country where the PRIMARY author was BORN — not where they lived, worked, or died.",
        "- Use modern country names (e.g. \"United Kingdom\", \"Russia\", \"Germany\").",
        "- Include the author's birth year if it is well documented; otherwise omit the field.",
        "- Include decimal latitude and longitude for the city center of the birthplace.",
        "- Use only verified biographical facts. If the birthplace is unknown, disputed, or the author is anonymous/pseudonymous, return confidence \"uncertain\" and null/empty values.",
        "- Do not guess based on language, nationality of writing, or where the book was published.",
        "",
        "Respond ONLY with valid JSON, no markdown or explanation:",
        "{",
        '  "authorName": "Jane Austen",',
        '  "city": "Steventon",',
        '  "country": "United Kingdom",',
        '  "birthYear": 1775,',
        '  "latitude": 51.2333,',
        '  "longitude": -1.2667,',
        '  "confidence": "high"',
        "}",
    ].join("\n");
}

function normalizeBirthplace(raw, fallbackAuthor) {
    if (!raw || typeof raw !== "object") return null;
    const confidence = typeof raw.confidence === "string" ? raw.confidence.trim().toLowerCase() : "";
    if (confidence === "uncertain" || confidence === "low") return null;

    const authorName = typeof raw.authorName === "string" ? raw.authorName.trim() : "";
    const city = typeof raw.city === "string" ? raw.city.trim() : "";
    const country = typeof raw.country === "string" ? raw.country.trim() : "";
    const latitude = Number(raw.latitude);
    const longitude = Number(raw.longitude);

    if (!city || !country) return null;
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return null;
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;

    const currentYear = new Date().getFullYear();
    const rawYear = Number(raw.birthYear);
    const birthYear = Number.isFinite(rawYear) && rawYear > 0 && rawYear <= currentYear ? Math.round(rawYear) : undefined;

    return {
        authorName: (authorName || fallbackAuthor || "").slice(0, 160),
        city: city.slice(0, 120),
        country: country.slice(0, 120),
        birthYear,
        latitude,
        longitude,
        confidence: confidence || "medium",
    };
}

async function resolveBirthplace(book, force) {
    const cachedVersion = Number(book.authorBirthplaceVersion) || 0;
    const cacheIsFresh = cachedVersion >= AUTHOR_BIRTHPLACE_VERSION;

    if (!force && cacheIsFresh) {
        if (hasUsableLocation(book.authorBirthplace)) {
            const loc = book.authorBirthplace.toObject
                ? book.authorBirthplace.toObject()
                : book.authorBirthplace;
            return { location: loc, cached: true, source: loc.source || null };
        }
        if (book.authorBirthplaceCheckedAt) {
            return { location: null, cached: true, source: null, skipped: true };
        }
    }

    const prompt = buildAuthorBirthplacePrompt(book);
    const primaryAuthor = pickPrimaryAuthor(book.authors);
    console.log(`[author-birthplace] book=${book._id} author="${primaryAuthor}" → calling LLM…`);
    const { text, source } = await callLlmForJson(prompt, { maxTokens: 600 });
    const parsed = safeJsonParse(text, {}) || {};
    const normalized = normalizeBirthplace(parsed, primaryAuthor);

    if (!normalized) {
        console.warn(`[author-birthplace] book=${book._id} no confident birthplace returned — caching negative result`);
        book.set({
            authorBirthplace: undefined,
            authorBirthplaceCheckedAt: new Date(),
            authorBirthplaceVersion: AUTHOR_BIRTHPLACE_VERSION,
        });
        book.markModified("authorBirthplace");
        book.markModified("authorBirthplaceCheckedAt");
        book.markModified("authorBirthplaceVersion");
        try {
            await book.save();
        } catch (e) {
            console.warn("[author-birthplace] failed to persist negative result:", e && e.message ? e.message : e);
        }
        return { location: null, cached: false, source };
    }

    const location = {
        ...normalized,
        source,
        generatedAt: new Date(),
    };

    book.set({
        authorBirthplace: location,
        authorBirthplaceCheckedAt: new Date(),
        authorBirthplaceVersion: AUTHOR_BIRTHPLACE_VERSION,
    });
    book.markModified("authorBirthplace");
    book.markModified("authorBirthplaceCheckedAt");
    book.markModified("authorBirthplaceVersion");
    await book.save();
    console.log(`[author-birthplace] book=${book._id} saved ${location.authorName} → ${location.city}, ${location.country} (${source})`);

    return { location, cached: false, source };
}

/**
 * Resolves author birthplace for the map widget; caches hits and negative lookups on the book.
 * @param {object} bookInput Book document or `{ _id, authors, ... }`
 * @param {{ force?: boolean }} [options] bypass cache when true
 * @returns {Promise<object|null>} `{ city, country, latitude, longitude, ... }` or null
 */
async function getAuthorBirthplace(bookInput, options = {}) {
    if (!bookInput || !bookInput._id) {
        throw new Error("getAuthorBirthplace: book._id is required");
    }

    const force = !!options.force;
    const id = String(bookInput._id);
    const dedupKey = (force ? "force:" : "cache:") + id;
    if (inflight.has(dedupKey)) {
        return inflight.get(dedupKey);
    }

    const book = await Book.findById(id);
    if (!book) throw new Error(`Book not found: ${id}`);

    const promise = resolveBirthplace(book, force).finally(() => {
        inflight.delete(dedupKey);
    });
    inflight.set(dedupKey, promise);
    return promise;
}

module.exports = {
    getAuthorBirthplace,
    normalizeBirthplace,
    pickPrimaryAuthor,
};
