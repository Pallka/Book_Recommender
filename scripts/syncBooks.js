/**
 * Fetches Open Library works by subject, upserts into Mongo (`Book`), embeds with the same 128-d
 * `simpleEmbedding` as Python `ai-service` / `backend`, and upserts Qdrant points.
 * Triggered by POST /api/sync-books (internal key) or `node scripts/syncBooks.js`.
 */
if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}

const mongoose = require("mongoose");
const { Book } = require("../config");

const OPENLIBRARY_SUBJECT_URL = "https://openlibrary.org/subjects";
const QDRANT_URL = (process.env.QDRANT_URL || "http://127.0.0.1:6333").replace(/\/$/, "");
const QDRANT_COLLECTION = process.env.QDRANT_COLLECTION || "books";

const SUBJECTS = ["fiction", "fantasy", "science", "history"];
const OPENLIBRARY_LIMIT = 40;
/** Max subject API calls per run (Open Library rate limits). */
const MAX_REQUESTS_PER_RUN = 5;
const REQUEST_DELAY_MS = 1000;
const RETRY_DELAY_MS = 2000;
const MAX_RETRIES = 2;
const SKIP_FETCH_BOOK_COUNT_THRESHOLD = 100;
const MONGO_BATCH_SIZE = 50;
const QDRANT_BATCH_SIZE = 64;
const VECTOR_DIM = 128;

/** L2-normalized bag-of-chars vector; must stay in sync with Python services for the same dim. */
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

function normalizeGoogleItem(item) {
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
    : "/images/default-book.jpg";
  const publishedDate = item.first_publish_year ? String(item.first_publish_year) : "";
  const description = item.description
    ? (typeof item.description === "string" ? item.description : String(item.description.value || ""))
    : "";

  const isbn13 = `ol-${olid}`; // synthetic unique key for Open Library–only rows

  return {
    olid,
    title,
    authors,
    description,
    categories,
    thumbnail,
    publishedDate,
    isbn13
  };
}

async function fetchSubjectWithRetry(subject) {
  const url = `${OPENLIBRARY_SUBJECT_URL}/${encodeURIComponent(subject)}.json?limit=${OPENLIBRARY_LIMIT}`;

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

async function fetchBooksFromSubjects() {
  const all = [];
  const subjectsToUse = SUBJECTS.slice(0, MAX_REQUESTS_PER_RUN);
  let requestsMade = 0;

  for (const subject of subjectsToUse) {
    const items = await fetchSubjectWithRetry(subject);
    requestsMade += 1;
    all.push(...items);
    console.log(`[syncBooks] subject=${subject}, fetched=${items.length} works`);
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

/** Stable positive int id from string (Qdrant point id); same olid → same id across runs. */
function qdrantPointId(uniqueId) {
  let hash = 0;
  const s = String(uniqueId || "");
  for (let i = 0; i < s.length; i += 1) {
    hash = ((hash << 5) - hash) + s.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) + 1;
}

/** Upserts batches to QDRANT_COLLECTION; vectors from description or title+categories. */
async function upsertQdrantPoints(docs) {
  if (!docs.length) return 0;
  await ensureQdrantCollection();
  let count = 0;
  for (const batch of chunkArray(docs, QDRANT_BATCH_SIZE)) {
    const points = batch.map((b) => ({
      id: qdrantPointId(b.olid),
      vector: simpleEmbedding(b.description || `${b.title}. ${b.categories || ""}`),
      payload: {
        olid: b.olid,
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

async function saveToMongo(books) {
  if (!books.length) return { insertedCount: 0, insertedDocs: [], skippedDuplicates: 0 };

  const olids = books.map((b) => b.olid);
  const existing = await Book.find({ olid: { $in: olids } }, { olid: 1 }).lean();
  const existingSet = new Set(existing.map((b) => String(b.olid)));
  const newBooks = books.filter((b) => !existingSet.has(String(b.olid)));
  const skippedDuplicates = books.length - newBooks.length;

  if (!newBooks.length) {
    return { insertedCount: 0, insertedDocs: [], skippedDuplicates };
  }

  const insertedDocs = [];

  for (const batch of chunkArray(newBooks, MONGO_BATCH_SIZE)) {
    const ops = batch.map((b) => ({
      updateOne: {
        filter: { olid: b.olid },
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

/** @returns {Promise<object>} Stats object; throws on Open Library / Mongo / Qdrant failure. */
async function syncBooks() {
  const startedAt = Date.now();
  console.log("[syncBooks] Start");
  try {
    const existingCount = await Book.countDocuments({ olid: { $exists: true, $ne: null } });
    if (existingCount > SKIP_FETCH_BOOK_COUNT_THRESHOLD) {
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
    console.log(`[syncBooks] Fetched raw OpenLibrary works: ${rawBooks.length}`);

    const map = new Map();
    for (const item of rawBooks) {
      const normalized = normalizeGoogleItem(item);
      if (!normalized) continue;
      if (!map.has(normalized.olid)) {
        map.set(normalized.olid, normalized);
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

