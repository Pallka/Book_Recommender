/** Google Books or Open Library → Mongo + Qdrant; embedding must match Python services (128-d). */
try {
  require("dotenv").config();
} catch (_) {
  /* dotenv optional */
}

const mongoose = require("mongoose");
const { Book } = require("../config");

const GOOGLE_BOOKS_URL = "https://www.googleapis.com/books/v1/volumes";
const GOOGLE_BOOKS_API_KEY = (process.env.GOOGLE_BOOKS_API_KEY || "").trim();
const OPENLIBRARY_SUBJECT_URL = "https://openlibrary.org/subjects";
const BOOKS_SOURCE = (process.env.BOOKS_SOURCE || "google").toLowerCase().trim();
const QDRANT_URL = (process.env.QDRANT_URL || "http://127.0.0.1:6333").replace(/\/$/, "");
const QDRANT_COLLECTION = process.env.QDRANT_COLLECTION || "books";

const DEFAULT_SUBJECTS = [
  "fiction", "fantasy", "science", "history",
  "romance", "mystery", "biography", "poetry",
  "philosophy", "thriller",
];
const SUBJECTS = (process.env.BOOKS_SUBJECTS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const ACTIVE_SUBJECTS = SUBJECTS.length ? SUBJECTS : DEFAULT_SUBJECTS;

const FETCH_LIMIT = 40;
const MAX_REQUESTS_PER_RUN = parseInt(process.env.MAX_REQUESTS_PER_RUN || "5", 10);
const RANDOM_OFFSET_MAX = parseInt(process.env.BOOKS_RANDOM_OFFSET_MAX || "200", 10);
function randomStartIndex() {
  return Math.floor(Math.random() * Math.max(1, RANDOM_OFFSET_MAX));
}
const REQUEST_DELAY_MS = 1000;
const RETRY_DELAY_MS = 2000;
const MAX_RETRIES = 2;
const SKIP_FETCH_BOOK_COUNT_THRESHOLD = parseInt(
  process.env.SKIP_FETCH_BOOK_COUNT_THRESHOLD || "100",
  10
);
const SYNC_BOOKS_IGNORE_THRESHOLD = ["1", "true", "yes"].includes(
  String(process.env.SYNC_BOOKS_IGNORE_THRESHOLD || "").toLowerCase()
);
const MONGO_BATCH_SIZE = 50;
const QDRANT_BATCH_SIZE = 64;
const VECTOR_DIM = 128;

function simpleEmbedding(text, dim = VECTOR_DIM) {
  const out = new Array(dim).fill(0);
  if (!text) return out;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    out[i % dim] += (code % 23) / 23;
  }
  const norm = Math.sqrt(out.reduce((acc, v) => acc + v * v, 0)) || 1;
  return out.map((v) => v / norm);
}

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseYearFromPublishedDate(s) {
  if (!s || typeof s !== "string") return undefined;
  const m = String(s).trim().match(/^(\d{4})/);
  if (!m) return undefined;
  const y = parseInt(m[1], 10);
  return Number.isFinite(y) ? y : undefined;
}

function normalizeOpenLibraryItem(item) {
  const title = item && item.title ? String(item.title).trim() : "";
  const olid = item && item.key ? String(item.key).replace("/works/", "").trim() : "";
  if (!title || !olid) return null;

  const authors = Array.isArray(item.authors) && item.authors.length
    ? item.authors.map((a) => a && a.name ? String(a.name) : "").filter(Boolean).join(", ")
    : "Unknown";
  const categories = Array.isArray(item.subject) && item.subject.length
    ? item.subject.join(", ")
    : "Fiction";
  const thumbnail = item.cover_id
    ? `https://covers.openlibrary.org/b/id/${item.cover_id}-L.jpg`
    : "/images/no-cover.svg";
  const publishedDate = item.first_publish_year ? String(item.first_publish_year) : "";
  const description = item.description
    ? (typeof item.description === "string" ? item.description : String(item.description.value || ""))
    : "";

  const y = item.first_publish_year;
  const published_year =
    y != null && Number.isFinite(Number(y)) ? Math.trunc(Number(y)) : undefined;
  const pagesMedian = item.number_of_pages_median;
  const num_pages =
    pagesMedian != null && Number.isFinite(Number(pagesMedian))
      ? Math.trunc(Number(pagesMedian))
      : undefined;

  const isbn13 = `ol-${olid}`;

  const out = {
    olid,
    title,
    authors,
    description,
    categories,
    thumbnail,
    publishedDate,
    isbn13
  };
  if (published_year != null) out.published_year = published_year;
  if (num_pages != null) out.num_pages = num_pages;
  return out;
}

function pickGoogleIsbn(volumeInfo) {
  const ids = Array.isArray(volumeInfo?.industryIdentifiers)
    ? volumeInfo.industryIdentifiers
    : [];
  const isbn13 = ids.find((x) => x && x.type === "ISBN_13" && x.identifier);
  if (isbn13?.identifier) return String(isbn13.identifier);
  const isbn10 = ids.find((x) => x && x.type === "ISBN_10" && x.identifier);
  if (isbn10?.identifier) return `isbn10-${isbn10.identifier}`;
  return null;
}

function normalizeGoogleBookItem(item) {
  const volumeInfo = item?.volumeInfo || {};
  const title = volumeInfo?.title ? String(volumeInfo.title).trim() : "";
  const googleId = item?.id ? String(item.id).trim() : "";
  if (!title || !googleId) return null;

  const authors = Array.isArray(volumeInfo.authors) && volumeInfo.authors.length
    ? volumeInfo.authors.map((a) => String(a || "").trim()).filter(Boolean).join(", ")
    : "Unknown";
  const categories = Array.isArray(volumeInfo.categories) && volumeInfo.categories.length
    ? volumeInfo.categories.map((c) => String(c || "").trim()).filter(Boolean).join(", ")
    : "General";
  const description = volumeInfo.description ? String(volumeInfo.description) : "";
  const publishedDate = volumeInfo.publishedDate ? String(volumeInfo.publishedDate) : "";
  const published_year = parseYearFromPublishedDate(publishedDate);
  const pc = volumeInfo.pageCount;
  const num_pages =
    pc != null && Number.isFinite(Number(pc)) ? Math.trunc(Number(pc)) : undefined;
  const thumbnail = volumeInfo?.imageLinks?.thumbnail
    ? String(volumeInfo.imageLinks.thumbnail).replace("http://", "https://")
    : "/images/no-cover.svg";
  const isbn13 = pickGoogleIsbn(volumeInfo) || `gb-${googleId}`;

  const out = {
    googleId,
    title,
    authors,
    description,
    categories,
    thumbnail,
    publishedDate,
    isbn13
  };
  if (published_year != null) out.published_year = published_year;
  if (num_pages != null) out.num_pages = num_pages;
  return out;
}

async function fetchOpenLibrarySubjectWithRetry(subject, offset = 0) {
  const url = `${OPENLIBRARY_SUBJECT_URL}/${encodeURIComponent(subject)}.json?limit=${FETCH_LIMIT}&offset=${offset}`;

  let attempt = 0;
  while (true) {
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      return Array.isArray(data.works) ? data.works : [];
    }

    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < MAX_RETRIES) {
      attempt += 1;
      console.warn(`[syncBooks] Retry subject=${subject}, status=${res.status}, attempt ${attempt}/${MAX_RETRIES}`);
      await sleep(RETRY_DELAY_MS);
      continue;
    }

    const text = await res.text().catch(() => "");
    throw new Error(`OpenLibrary API error ${res.status} for subject=${subject}: ${text}`);
  }
}

async function fetchGoogleSubjectWithRetry(subject, startIndex = 0) {
  const q = encodeURIComponent(`subject:${subject}`);
  const keyPart = GOOGLE_BOOKS_API_KEY ? `&key=${encodeURIComponent(GOOGLE_BOOKS_API_KEY)}` : "";
  const url = `${GOOGLE_BOOKS_URL}?q=${q}&startIndex=${startIndex}&maxResults=${FETCH_LIMIT}&langRestrict=en${keyPart}`;

  let attempt = 0;
  while (true) {
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      return Array.isArray(data.items) ? data.items : [];
    }

    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < MAX_RETRIES) {
      attempt += 1;
      console.warn(`[syncBooks] Retry Google subject=${subject}, status=${res.status}, attempt ${attempt}/${MAX_RETRIES}`);
      await sleep(RETRY_DELAY_MS);
      continue;
    }

    const text = await res.text().catch(() => "");
    throw new Error(`Google Books API error ${res.status} for subject=${subject}: ${text}`);
  }
}

async function fetchSubjectAt(subject, offset) {
  return BOOKS_SOURCE === "openlibrary"
    ? fetchOpenLibrarySubjectWithRetry(subject, offset)
    : fetchGoogleSubjectWithRetry(subject, offset);
}

async function fetchBooksFromSubjects() {
  const all = [];
  const subjectsToUse = ACTIVE_SUBJECTS.slice(0, MAX_REQUESTS_PER_RUN);
  let requestsMade = 0;

  for (const subject of subjectsToUse) {
    const offset = randomStartIndex();
    let items = await fetchSubjectAt(subject, offset);
    requestsMade += 1;

    let finalOffset = offset;
    if (!items.length && offset > 0) {
      const retryOffset = Math.floor(offset / 4);
      console.log(`[syncBooks] subject=${subject} offset=${offset} returned 0; retrying at offset=${retryOffset}`);
      await sleep(REQUEST_DELAY_MS);
      items = await fetchSubjectAt(subject, retryOffset);
      requestsMade += 1;
      finalOffset = retryOffset;

      if (!items.length && retryOffset > 0) {
        console.log(`[syncBooks] subject=${subject} retry empty; falling back to offset=0`);
        await sleep(REQUEST_DELAY_MS);
        items = await fetchSubjectAt(subject, 0);
        requestsMade += 1;
        finalOffset = 0;
      }
    }

    all.push(...items);
    console.log(`[syncBooks] source=${BOOKS_SOURCE}, subject=${subject}, offset=${finalOffset}, fetched=${items.length}`);
    await sleep(REQUEST_DELAY_MS);
  }

  return { items: all, requestsMade };
}

async function ensureQdrantCollection() {
  const r = await fetch(`${QDRANT_URL}/collections/${QDRANT_COLLECTION}`);
  if (r.ok) return;
  const createRes = await fetch(`${QDRANT_URL}/collections/${QDRANT_COLLECTION}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      vectors: { size: VECTOR_DIM, distance: "Cosine" }
    })
  });
  if (!createRes.ok) {
    const txt = await createRes.text().catch(() => "");
    throw new Error(`Qdrant collection create failed: ${createRes.status} ${txt}`);
  }
}

function qdrantPointId(uniqueId) {
  let hash = 0;
  const s = String(uniqueId || "");
  for (let i = 0; i < s.length; i += 1) {
    hash = ((hash << 5) - hash) + s.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) + 1;
}

async function upsertQdrantPoints(docs) {
  if (!docs.length) return 0;
  await ensureQdrantCollection();
  let count = 0;
  for (const batch of chunkArray(docs, QDRANT_BATCH_SIZE)) {
    const points = batch.map((b) => ({
      id: qdrantPointId(b.olid || b.googleId || b.isbn13 || b.title),
      vector: simpleEmbedding(b.description || `${b.title}. ${b.categories || ""}`),
      payload: {
        olid: b.olid,
        googleId: b.googleId,
        title: b.title,
        authors: b.authors,
        categories: b.categories
      }
    }));
    const res = await fetch(`${QDRANT_URL}/collections/${QDRANT_COLLECTION}/points?wait=true`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ points })
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Qdrant upsert failed: ${res.status} ${txt}`);
    }
    count += points.length;
  }
  return count;
}

/**
 * Inserts new books only; skips existing `isbn13` values.
 * @param {object[]} books normalized catalog rows
 * @returns {Promise<{ insertedCount: number, insertedDocs: object[], skippedDuplicates: number }>}
 */
async function saveToMongo(books) {
  if (!books.length) return { insertedCount: 0, insertedDocs: [], skippedDuplicates: 0 };

  const isbn13s = books.map((b) => b.isbn13).filter(Boolean);
  const existing = await Book.find({ isbn13: { $in: isbn13s } }, { isbn13: 1 }).lean();
  const existingSet = new Set(existing.map((b) => String(b.isbn13)));
  const newBooks = books.filter((b) => !existingSet.has(String(b.isbn13)));
  const skippedDuplicates = books.length - newBooks.length;

  if (!newBooks.length) {
    return { insertedCount: 0, insertedDocs: [], skippedDuplicates };
  }

  const insertedDocs = [];

  for (const batch of chunkArray(newBooks, MONGO_BATCH_SIZE)) {
    const ops = batch.map((b) => ({
      updateOne: {
        filter: { isbn13: b.isbn13 },
        update: { $setOnInsert: b },
        upsert: true
      }
    }));
    const result = await Book.bulkWrite(ops, { ordered: false });
    const ids = result && result.upsertedIds
      ? Object.values(result.upsertedIds).map((id) => String(id))
      : [];
    if (ids.length) {
      const fresh = await Book.find({ _id: { $in: ids } }).lean();
      insertedDocs.push(...fresh);
    }
  }

  return { insertedCount: insertedDocs.length, insertedDocs, skippedDuplicates };
}

/**
 * Fetches books from external APIs, upserts Mongo, vectors new rows into Qdrant.
 * @returns {Promise<object>} run stats (`skipped`, counts, `durationMs`)
 */
async function syncBooks() {
  const startedAt = Date.now();
  console.log("[syncBooks] Start");
  try {
    const existingCount = await Book.countDocuments({ isbn13: { $exists: true, $ne: null } });
    if (SYNC_BOOKS_IGNORE_THRESHOLD) {
      console.log(
        `[syncBooks] SYNC_BOOKS_IGNORE_THRESHOLD set — skipping size guard (${existingCount} books in DB)`
      );
    }
    if (!SYNC_BOOKS_IGNORE_THRESHOLD && existingCount > SKIP_FETCH_BOOK_COUNT_THRESHOLD) {
      const durationMs = Date.now() - startedAt;
      const result = {
        skipped: true,
        reason: `Existing books count (${existingCount}) is above threshold (${SKIP_FETCH_BOOK_COUNT_THRESHOLD})`,
        requestsMade: 0,
        fetched: 0,
        normalized: 0,
        inserted: 0,
        skippedDuplicates: 0,
        qdrantUpserted: 0,
        durationMs
      };
      console.log("[syncBooks] Skip fetch:", result.reason);
      return result;
    }

    const { items: rawBooks, requestsMade } = await fetchBooksFromSubjects();
    console.log(`[syncBooks] Requests made: ${requestsMade}`);
    console.log(`[syncBooks] Fetched raw books from ${BOOKS_SOURCE}: ${rawBooks.length}`);

    const map = new Map();
    for (const item of rawBooks) {
      const normalized = BOOKS_SOURCE === "openlibrary"
        ? normalizeOpenLibraryItem(item)
        : normalizeGoogleBookItem(item);
      if (!normalized) continue;
      if (!map.has(normalized.isbn13)) {
        map.set(normalized.isbn13, normalized);
      }
    }
    const normalizedBooks = Array.from(map.values());
    console.log(`[syncBooks] Normalized unique books: ${normalizedBooks.length}`);

    const { insertedCount, insertedDocs, skippedDuplicates } = await saveToMongo(normalizedBooks);
    console.log(`[syncBooks] Mongo inserted: ${insertedCount}`);
    console.log(`[syncBooks] Skipped duplicates: ${skippedDuplicates}`);

    const qdrantCount = await upsertQdrantPoints(insertedDocs);
    console.log(`[syncBooks] Qdrant upserted vectors: ${qdrantCount}`);

    const durationMs = Date.now() - startedAt;
    const result = {
      skipped: false,
      requestsMade,
      fetched: rawBooks.length,
      normalized: normalizedBooks.length,
      inserted: insertedCount,
      skippedDuplicates,
      qdrantUpserted: qdrantCount,
      durationMs
    };
    console.log("[syncBooks] Done:", result);
    return result;
  } catch (error) {
    console.error("[syncBooks] Failed:", error.message);
    throw error;
  }
}

if (require.main === module) {
  syncBooks()
    .then((r) => {
      console.log("Sync success:", r);
      return mongoose.connection.close();
    })
    .then(() => process.exit(0))
    .catch(async (e) => {
      console.error("Sync error:", e);
      try { await mongoose.connection.close(); } catch (_) {}
      process.exit(1);
    });
}

module.exports = { syncBooks };

