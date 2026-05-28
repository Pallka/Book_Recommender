if (process.env.NODE_ENV !== "production") {
    require("dotenv").config();
}

const express = require("express");
const app = express();
const bcrypt = require("bcrypt");
const passport = require("passport");
const flash = require("express-flash");
const session = require("express-session");
const methodOverride = require("method-override");
const mongoose = require("mongoose");
const initializePassport = require("./passport-config");
const { User, Book, SearchHistory, AiInteraction } = require("./config");
const modelHandler = require('./model/modelHandler');
const { syncBooks } = require("./scripts/syncBooks");
const { enrichBookData, detectMissingFields } = require("./services/bookEnrichment");
const { generateBookTimeline } = require("./services/bookTimeline");
const { getAuthorBirthplace } = require("./services/authorBirthplace");

modelHandler.loadModel()
    .then(() => console.log('✅ Model initialized successfully'))
    .catch(err => console.error('❌ Model initialization error:', err));

initializePassport(
    passport,
    async email => await User.findOne({ email }),
    async id => await User.findById(id)
);

const PORT = process.env.PORT || 3000;
const AI_SERVICE_URL = (process.env.AI_SERVICE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || "";

app.set("view engine", "ejs");
app.set("views", "./views");
app.use(express.static("views"));
app.use("/sample_ai_agent", express.static("sample_ai_agent"));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(flash());
app.use(session({
    secret: process.env.SECRET_KEY || "secret",
    resave: false,
    saveUninitialized: false
}));
app.use(passport.initialize());
app.use(passport.session());
app.use(methodOverride("_method"));

app.use((req, res, next) => {
    res.locals.error = req.flash("error");
    res.locals.success = req.flash("success");
    next();
});

app.get("/", (req, res) => res.render("index"));
app.get("/login", checkNotAuthenticated, (req, res) => res.render("login"));
app.get("/register", checkNotAuthenticated, (req, res) => res.render("register"));

app.post("/login", checkNotAuthenticated, passport.authenticate("local", {
    successRedirect: "/home",
    failureRedirect: "/error",
    failureFlash: true
}));

app.post("/register", checkNotAuthenticated, async (req, res) => {
    const data = {
        name: req.body.name,
        email: req.body.email,
        password: req.body.password
    };

    if (!data.name || !data.email || !data.password) {
        req.flash("error", "All fields are required.");
        return res.redirect("/register");
    }
    try {
        console.log("Checking for existing user...");
        const existingUser = await User.findOne({ email: data.email });
        if (existingUser) {
            req.flash("error", "User already exists");
            return res.redirect("/register");
        }

        console.log("Hashing password...");
        const hashedPassword = await bcrypt.hash(data.password, 10);
        data.password = hashedPassword;
        
        console.log("Creating new user...");
        const newUser = new User(data);
        console.log("User data to save:", { ...data, password: '[HIDDEN]' });
        
        const savedUser = await newUser.save();
        console.log("User saved successfully:", savedUser._id);
        
        res.render("register_success");
    } catch (error) {
        console.error("Signup error details:", {
            message: error.message,
            code: error.code,
            name: error.name,
            stack: error.stack
        });
        res.render("error");
    }
});

app.get("/home", checkAuthenticated, async (req, res) => {
    try {
        const user = await User.findById(req.user._id).populate('savedBooks');
        res.render("home", { 
            name: user.name,
            books: user.savedBooks || []
        });
    } catch (error) {
        console.error('Error fetching saved books:', error);
        res.render("home", { 
            name: req.user.name,
            books: [],
            error: 'Failed to load saved books'
        });
    }
});

app.delete("/logout", (req, res, next) => {
    req.logout(err => {
        if (err) return next(err);
        res.redirect("/login");
    });
});

app.get("/about", (req, res) => res.render("about"));
app.get("/faqs", (req, res) => res.render("faqs"));
app.get("/register_seccess", (req, res) => res.render("register_seccess"));
app.get("/error", (req, res) => res.render("error"));

app.post("/api/sync-books", async (req, res) => {
    if (!internalKeyOk(req)) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
    }
    try {
        const result = await syncBooks();
        return res.json({
            success: true,
            message: "Books synchronized successfully",
            ...result
        });
    } catch (error) {
        console.error("[/api/sync-books] Failed:", error.message);
        return res.status(500).json({
            success: false,
            error: "Failed to sync books",
            details: error.message
        });
    }
});

function internalKeyOk(req) {
    if (!INTERNAL_API_KEY) return true;
    const k = req.headers["x-internal-key"] || req.query.internal_key;
    return k === INTERNAL_API_KEY;
}

/** Quoted phrases in assistant text as candidate book titles (min length 3). */
function extractQuotedTitles(text) {
    const out = [];
    const src = String(text || "");
    if (!src) return out;
    const pattern = /"([^"\n]{3,80})"|"([^"\n]{3,80})"|'([^'\n]{3,80})'|«([^»\n]{3,80})»|„([^"\n]{3,80})"/g;
    let m;
    while ((m = pattern.exec(src)) !== null) {
        const raw = (m[1] || m[2] || m[3] || m[4] || m[5] || "").trim();
        if (raw && raw.length >= 3) out.push(raw);
    }
    return out;
}

/** Resolves title strings to book cards; prefers titles substring-matching `replyText`, else first matches. */
async function resolveBookCardsForChat(titles, replyText) {
    const seen = new Set();
    const cleaned = [];
    for (const t of titles || []) {
        const s = typeof t === "string" ? t.trim() : "";
        if (!s || s.length < 3) continue;
        const key = s.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        cleaned.push(s);
        if (cleaned.length >= 16) break;
    }
    if (!cleaned.length) return [];

    const lookups = await Promise.all(cleaned.map(async (title) => {
        const esc = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        try {
            return await Book.findOne({ title: new RegExp("^" + esc + "$", "i") })
                .select("_id title authors thumbnail")
                .lean();
        } catch {
            return null;
        }
    }));

    const found = lookups.filter(Boolean);
    if (!found.length) return [];

    const toCard = (b) => ({
        _id: String(b._id),
        title: b.title,
        authors: b.authors || "",
        thumbnail: b.thumbnail || "/images/no-cover.svg",
        url: `/books/${String(b._id)}`
    });

    const replyLower = String(replyText || "").toLowerCase();
    if (replyLower) {
        const mentioned = [];
        const usedIds = new Set();
        for (const b of found) {
            if (!b.title || b.title.length < 4) continue;
            if (replyLower.includes(b.title.toLowerCase()) && !usedIds.has(String(b._id))) {
                usedIds.add(String(b._id));
                mentioned.push(toCard(b));
            }
            if (mentioned.length >= 6) break;
        }
        if (mentioned.length) return mentioned;
    }

    const fallback = [];
    const usedIds = new Set();
    for (const b of found) {
        const id = String(b._id);
        if (usedIds.has(id)) continue;
        usedIds.add(id);
        fallback.push(toCard(b));
        if (fallback.length >= 4) break;
    }
    return fallback;
}

/** Widget chat: proxy to ai-service, else Groq/OpenAI/Ollama; attaches book cards + interaction log. */
app.post("/api/ai/chat", async (req, res) => {
    try {
        const message = (req.body && req.body.message ? String(req.body.message) : "").trim();
        const history = Array.isArray(req.body && req.body.history ? req.body.history : [])
            ? req.body.history.slice(-20)
            : [];

        if (!message) {
            return res.status(400).json({ error: "Message is required" });
        }

        const userId = typeof req.isAuthenticated === "function" && req.isAuthenticated() && req.user && req.user._id
            ? String(req.user._id)
            : (req.body.user_id ? String(req.body.user_id) : null);

        const currentBookRaw = req.body && req.body.current_book && typeof req.body.current_book === "object"
            ? req.body.current_book
            : null;
        const currentBook = currentBookRaw && currentBookRaw.title && currentBookRaw._id
            ? {
                _id: String(currentBookRaw._id),
                title: String(currentBookRaw.title),
                authors: currentBookRaw.authors ? String(currentBookRaw.authors) : "",
                url: currentBookRaw.url ? String(currentBookRaw.url) : `/books/${String(currentBookRaw._id)}`,
                thumbnail: currentBookRaw.thumbnail ? String(currentBookRaw.thumbnail) : "/images/no-cover.svg"
            }
            : null;
        const currentBookContext = currentBook
            ? `Current book page context: title="${currentBook.title}", author(s)="${currentBook.authors}", URL="${currentBook.url}". If the user asks about "this book", answer about this exact book.`
            : "";
        const messageForAi = currentBookContext
            ? `${currentBookContext}\n\nUser message:\n${message}`
            : message;

        try {
            const chatUrl = `${AI_SERVICE_URL}/chat`;
            const ac = new AbortController();
            const t = setTimeout(() => ac.abort(), 120000);
            const pyRes = await fetch(chatUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    user_input: messageForAi,
                    user_id: userId,
                    history: history.map(m => ({ role: m.role, content: m.content }))
                }),
                signal: ac.signal
            });
            clearTimeout(t);
            if (pyRes.ok) {
                const data = await pyRes.json();
                const reply = typeof data.reply === "string" ? data.reply : (data.response || "");
                const explanation = data.explanation;
                const semantic_hits = data.semantic_hits;
                const ml_books = data.ml_books;
                if (reply) {
                    let interactionId = null;
                    try {
                        await SearchHistory.create({ user_id: userId || undefined, query: message });
                        const created = await AiInteraction.create({
                            user_id: userId || undefined,
                            query: message,
                            response: reply,
                            meta: { explanation, semantic_hits, ml_books, source: "python" }
                        });
                        interactionId = created && created._id ? String(created._id) : null;
                    } catch (e) { console.warn("AiInteraction save:", e.message); }

                    const candidateTitles = [
                        ...(currentBook ? [currentBook.title] : []),
                        ...extractQuotedTitles(reply),
                        ...(Array.isArray(semantic_hits) ? semantic_hits.map(h => h && h.title).filter(Boolean) : []),
                        ...(Array.isArray(ml_books) ? ml_books.map(h => h && h.title).filter(Boolean) : [])
                    ];
                    let books = [];
                    try {
                        books = await resolveBookCardsForChat(candidateTitles, reply);
                    } catch (e) {
                        console.warn("resolveBookCardsForChat:", e.message);
                    }

                    return res.json({
                        reply,
                        explanation,
                        recommendations: { semantic: semantic_hits, ml: ml_books },
                        books,
                        ...(interactionId ? { interactionId } : {})
                    });
                }
            } else {
                console.warn("AI service returned", pyRes.status, await pyRes.text().catch(() => ""));
            }
        } catch (e) {
            console.warn("AI service unavailable, fallback:", e.message);
        }

        const systemPrompt =
            "You are a helpful assistant for a Book Recommender web app. " +
            "Keep responses concise. Help users find books, genres, and explain how to use the site. " +
            "If you don't know something, ask a short clarifying question. " +
            "Use plain text only: no Markdown headings (#), no **bold**, no backticks. " +
            "Separate paragraphs with a blank line; for lists put each item on its own line starting with \"- \" (hyphen and space). " +
            "Do not run list items together on one line with asterisks.";

        let llmOut = null;
        try {
            llmOut = await tryLlmChat({ systemPrompt, history, message: messageForAi });
        } catch (e) {
            console.warn("LLM fallback chain error:", e.message);
        }
        if (llmOut && llmOut.text) {
            let interactionId = null;
            try {
                const created = await AiInteraction.create({
                    user_id: userId || undefined,
                    query: message,
                    response: llmOut.text,
                    meta: { source: llmOut.source || "llm" }
                });
                interactionId = created && created._id ? String(created._id) : null;
            } catch (e) { /* ignore */ }

            let books = [];
            try {
                books = await resolveBookCardsForChat([
                    ...(currentBook ? [currentBook.title] : []),
                    ...extractQuotedTitles(llmOut.text)
                ], llmOut.text);
            } catch (e) {
                console.warn("resolveBookCardsForChat (llm):", e.message);
            }
            return res.json({
                reply: llmOut.text,
                books,
                ...(interactionId ? { interactionId } : {})
            });
        }

        const lower = message.toLowerCase();
        let reply =
            "I can help with book recommendations. Tell me: a genre you like, an author you enjoy, or a book you loved recently.";
        if (lower.includes("recommend") || lower.includes("suggest")) {
            reply =
                "Sure. What genre/mood do you want (e.g. fantasy, romance, thriller, nonfiction), and do you prefer short or long books?";
        } else if (lower.includes("how") && (lower.includes("use") || lower.includes("app"))) {
            reply =
                "Use the Books page to browse/search. Open a book to see details. If you’re logged in, save books to build your profile, then check Recommendations.";
        } else if (lower.includes("login") || lower.includes("sign in")) {
            reply = "Go to Log in, enter your email + password. If you don’t have an account yet, use Sign-up.";
        } else if (lower.includes("register") || lower.includes("sign up")) {
            reply = "Open Sign-up, fill name/email/password, then submit. After that you can log in and start saving books.";
        }

        let interactionId = null;
        try {
            const created = await AiInteraction.create({
                user_id: userId || undefined,
                query: message,
                response: reply,
                meta: { source: "keyword" }
            });
            interactionId = created && created._id ? String(created._id) : null;
        } catch (e) { /* ignore */ }

        return res.json({
            reply,
            ...(interactionId ? { interactionId } : {})
        });
    } catch (err) {
        console.error("AI chat error:", err);
        return res.status(500).json({ error: "AI chat failed" });
    }
});

/** Feedback: rows with `user_id` require the same session user; anonymous rows accept any client with the id. */
app.post("/api/ai/feedback", async (req, res) => {
    try {
        const interactionId = req.body && req.body.interactionId != null
            ? String(req.body.interactionId).trim()
            : "";
        const rating = req.body && req.body.rating != null ? String(req.body.rating).trim() : "";
        if (!interactionId || !mongoose.isValidObjectId(interactionId)) {
            return res.status(400).json({ error: "Invalid interactionId" });
        }
        if (rating !== "like" && rating !== "dislike") {
            return res.status(400).json({ error: "rating must be like or dislike" });
        }
        const doc = await AiInteraction.findById(interactionId).lean();
        if (!doc) {
            return res.status(404).json({ error: "Interaction not found" });
        }
        const sessionUid =
            typeof req.isAuthenticated === "function" && req.isAuthenticated() && req.user && req.user._id
                ? String(req.user._id)
                : null;
        if (doc.user_id && String(doc.user_id) !== sessionUid) {
            return res.status(403).json({ error: "Not allowed to rate this reply" });
        }
        await AiInteraction.updateOne(
            { _id: interactionId },
            { $set: { feedback: rating, feedbackAt: new Date() } }
        );
        return res.json({ ok: true });
    } catch (e) {
        console.warn("AI feedback error:", e.message);
        return res.status(500).json({ error: "Failed to save feedback" });
    }
});

app.get("/api/internal/books", async (req, res) => {
    if (!internalKeyOk(req)) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    const limit = Math.min(parseInt(req.query.limit, 10) || 2000, 10000);
    try {
        const books = await Book.find({}).limit(limit).lean();
        const out = books.map(b => ({
            id: String(b._id),
            title: b.title,
            description: typeof b.description === "string" ? b.description : "",
            categories: typeof b.categories === "string" ? b.categories : "",
            genre: typeof b.categories === "string" ? b.categories : "",
            authors: b.authors
        }));
        return res.json({ books: out, count: out.length });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: "Failed to list books" });
    }
});

async function getMlRecommendationsByTitle(req, res) {
    if (!internalKeyOk(req)) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    const title = String(req.query.title || "").trim();
    if (!title) {
        return res.status(400).json({ error: "title is required" });
    }
    try {
        if (!modelHandler.initialized) {
            await modelHandler.loadModel();
        }
        const esc = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const book = await Book.findOne({ title: new RegExp(esc, "i") });
        if (!book) {
            return res.json({ books: [], type: "not_found", message: "No book matching title" });
        }
        const profile = modelHandler.preprocessUserProfile([book]);
        const recommendedIndices = await modelHandler.getRecommendations(profile);
        const books = await Book.find({ bookIndex: { $in: recommendedIndices } }).limit(20).lean();
        return res.json({
            books,
            type: "by_title",
            seed: { title: book.title, id: String(book._id) }
        });
    } catch (e) {
        console.error("getMlRecommendationsByTitle:", e);
        return res.status(500).json({ error: "ML recommendations failed" });
    }
}

function openaiApiKey() {
    const raw = process.env.OPENAI_API_KEY;
    if (!raw) return "";
    return String(raw).trim().replace(/^['"]|['"]$/g, "");
}

function groqApiKey() {
    const raw = process.env.GROQ_API_KEY;
    if (!raw) return "";
    return String(raw).trim().replace(/^['"]|['"]$/g, "");
}

function buildLlmMessages(systemPrompt, history, message) {
    return [
        { role: "system", content: systemPrompt },
        ...history
            .filter(m => m && typeof m === "object" && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
            .map(m => ({ role: m.role, content: m.content })),
        { role: "user", content: message }
    ];
}

/** OpenAI-compatible POST …/chat/completions; `apiKey` may be empty (e.g. Ollama). */
async function fetchOpenAiCompatibleChat({ baseUrl, apiKey, model, messages }) {
    const root = String(baseUrl || "").replace(/\/$/, "");
    const url = `${root}/chat/completions`;
    const headers = { "Content-Type": "application/json" };
    const key = apiKey && String(apiKey).trim();
    if (key) headers["Authorization"] = `Bearer ${key}`;

    const resp = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
            model,
            messages,
            temperature: 0.4
        })
    });

    if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(`LLM ${resp.status}: ${text}`);
    }

    const json = await resp.json();
    const content = json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
    if (!content) throw new Error("LLM returned empty response");
    return String(content).trim();
}

/** LLM_PROVIDER / keys: try providers in order; first non-empty wins; throws last error if all fail. */
async function tryLlmChat({ systemPrompt, history, message }) {
    const messages = buildLlmMessages(systemPrompt, history, message);
    const mode = (process.env.LLM_PROVIDER || "auto").toLowerCase().trim();

    const groqModel = process.env.GROQ_MODEL || "llama-3.1-8b-instant";
    const ollamaBase = (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434/v1").replace(/\/$/, "");
    const ollamaModel = process.env.OLLAMA_MODEL || "llama3.2";

    /** @type {Array<{ name: string, run: () => Promise<string> }>} */
    const attempts = [];

    if (mode === "groq") {
        if (groqApiKey()) {
            attempts.push({
                name: "groq",
                run: () => fetchOpenAiCompatibleChat({
                    baseUrl: "https://api.groq.com/openai/v1",
                    apiKey: groqApiKey(),
                    model: groqModel,
                    messages
                })
            });
        }
    } else if (mode === "openai") {
        if (openaiApiKey()) {
            attempts.push({
                name: "openai",
                run: () => fetchOpenAiCompatibleChat({
                    baseUrl: "https://api.openai.com/v1",
                    apiKey: openaiApiKey(),
                    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
                    messages
                })
            });
        }
    } else if (mode === "ollama") {
        attempts.push({
            name: "ollama",
            run: () => fetchOpenAiCompatibleChat({
                baseUrl: ollamaBase,
                apiKey: "",
                model: ollamaModel,
                messages
            })
        });
    } else {
        if (groqApiKey()) {
            attempts.push({
                name: "groq",
                run: () => fetchOpenAiCompatibleChat({
                    baseUrl: "https://api.groq.com/openai/v1",
                    apiKey: groqApiKey(),
                    model: groqModel,
                    messages
                })
            });
        }
        if (openaiApiKey()) {
            attempts.push({
                name: "openai",
                run: () => fetchOpenAiCompatibleChat({
                    baseUrl: "https://api.openai.com/v1",
                    apiKey: openaiApiKey(),
                    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
                    messages
                })
            });
        }
        attempts.push({
            name: "ollama",
            run: () => fetchOpenAiCompatibleChat({
                baseUrl: ollamaBase,
                apiKey: "",
                model: ollamaModel,
                messages
            })
        });
    }

    let lastErr = null;
    for (const { name, run } of attempts) {
        try {
            const text = await run();
            if (text) return { text, source: name };
        } catch (e) {
            lastErr = e;
            console.warn(`LLM ${name}:`, e.message);
        }
    }
    if (lastErr) throw lastErr;
    return null;
}

app.get('/books', async (req, res) => {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = 12;
    const skip = (page - 1) * limit;
    const searchTerm = (req.query.search || '').trim();
    const yearFromRaw = (req.query.yearFrom || '').trim();
    const yearToRaw = (req.query.yearTo || '').trim();
    let yearFrom = yearFromRaw === '' ? null : parseInt(yearFromRaw, 10);
    let yearTo = yearToRaw === '' ? null : parseInt(yearToRaw, 10);
    if (yearFrom !== null && Number.isNaN(yearFrom)) yearFrom = null;
    if (yearTo !== null && Number.isNaN(yearTo)) yearTo = null;
    if (yearFrom !== null && yearTo !== null && yearFrom > yearTo) {
        const t = yearFrom;
        yearFrom = yearTo;
        yearTo = t;
    }

    const buildBooksPageUrl = (pageNum) => {
        const u = new URLSearchParams();
        if (searchTerm) u.set('search', searchTerm);
        if (yearFrom !== null) u.set('yearFrom', String(yearFrom));
        if (yearTo !== null) u.set('yearTo', String(yearTo));
        u.set('page', String(pageNum));
        return '/books?' + u.toString();
    };

    const clearYearFilterUrl = (() => {
        const u = new URLSearchParams();
        if (searchTerm) u.set('search', searchTerm);
        const q = u.toString();
        return q ? '/books?' + q : '/books';
    })();

    const hasYearFilter = yearFrom !== null || yearTo !== null;

    /** Year filter: `published_year` number or first 4 chars of `publishedDate` (string-only rows). */
    function mongoYearRangeClause(from, to) {
        const lo = from != null ? from : 1000;
        const hi = to != null ? to : 9999;
        let lo2 = lo;
        let hi2 = hi;
        if (lo2 > hi2) {
            const t = lo2;
            lo2 = hi2;
            hi2 = t;
        }

        const numClause = {
            published_year: {
                $type: 'number',
                ...(from != null ? { $gte: from } : {}),
                ...(to != null ? { $lte: to } : {}),
            },
        };

        const dateYearExpr = {
            $expr: {
                $let: {
                    vars: {
                        y: {
                            $convert: {
                                input: { $substrCP: [{ $ifNull: ['$publishedDate', ''] }, 0, 4] },
                                to: 'int',
                                onError: null,
                                onNull: null,
                            },
                        },
                    },
                    in: {
                        $and: [
                            { $ne: ['$$y', null] },
                            { $gte: ['$$y', lo2] },
                            { $lte: ['$$y', hi2] },
                        ],
                    },
                },
            },
        };

        return { $or: [numClause, dateYearExpr] };
    }

    try {
        const filter = {};
        if (searchTerm) {
            filter.$or = [
                { title: new RegExp(searchTerm, 'i') },
                { authors: new RegExp(searchTerm, 'i') },
            ];
        }
        if (yearFrom !== null || yearTo !== null) {
            const yearClause = mongoYearRangeClause(yearFrom, yearTo);
            if (searchTerm) {
                filter.$and = [{ $or: filter.$or }, yearClause];
                delete filter.$or;
            } else {
                filter.$or = yearClause.$or;
            }
        }

        const totalCatalogCount = await Book.countDocuments({});
        const totalBooks = await Book.countDocuments(filter);
        const totalPages = Math.max(1, Math.ceil(totalBooks / limit));
        const books = await Book.aggregate([
            { $match: filter },
            {
                $addFields: {
                    _ratingTier: {
                        $switch: {
                            branches: [
                                { case: { $gte: [{ $ifNull: ['$average_rating', 0] }, 4.5] }, then: 5 },
                                { case: { $gte: [{ $ifNull: ['$average_rating', 0] }, 4.0] }, then: 4 },
                                { case: { $gte: [{ $ifNull: ['$average_rating', 0] }, 3.5] }, then: 3 },
                                { case: { $gt:  [{ $ifNull: ['$average_rating', 0] }, 0] },   then: 2 },
                            ],
                            default: 1,
                        },
                    },
                },
            },
            { $sort: { _ratingTier: -1, _id: -1 } },
            { $skip: skip },
            { $limit: limit },
            { $project: { _ratingTier: 0 } },
        ]);

        let savedBookIds = [];
        if (req.isAuthenticated()) {
            const user = await User.findById(req.user._id);
            savedBookIds = user.savedBooks.map(id => id.toString());
        }

        return res.render('books', {
            books,
            currentPage: page,
            totalPages,
            totalBooks,
            totalCatalogCount,
            searchTerm,
            yearFrom: yearFrom !== null ? String(yearFrom) : '',
            yearTo: yearTo !== null ? String(yearTo) : '',
            buildBooksPageUrl,
            clearYearFilterUrl,
            hasYearFilter,
            savedBookIds
        });
    } catch (err) {
        console.error('Books fetch error:', err);
        return res.status(500).send('Internal Server Error');
    }
});

app.get('/books/:id', async (req, res) => {
    try {
        const book = await Book.findById(req.params.id);
        if (!book) {
            return res.status(404).send('Book not found');
        }

        let isSaved = false;
        if (req.isAuthenticated()) {
            const user = await User.findById(req.user._id);
            isSaved = user.savedBooks.includes(book._id);
        }

        res.render('book-details', { book, isSaved });
    } catch (err) {
        console.error('Error fetching book details:', err);
        res.status(500).send('Server error');
    }
});

app.get('/api/books/:id/timeline', async (req, res) => {
    const { id } = req.params;
    const force = req.query.force === '1' || req.query.force === 'true';
    try {
        const result = await generateBookTimeline({ _id: id }, { force });
        return res.json({
            success: true,
            cached: result.cached,
            source: result.source,
            generatedAt: result.generatedAt,
            timeline: result.timeline,
        });
    } catch (err) {
        console.error('Timeline error:', err);
        if (err && /Book not found/.test(err.message)) {
            return res.status(404).json({ success: false, error: 'Book not found' });
        }
        return res.status(500).json({
            success: false,
            error: 'Failed to generate timeline',
            details: err && err.message ? err.message : String(err),
        });
    }
});

app.get('/api/books/:id/author-birthplace', async (req, res) => {
    const { id } = req.params;
    const force = req.query.force === '1' || req.query.force === 'true';
    try {
        const result = await getAuthorBirthplace({ _id: id }, { force });
        return res.json({
            success: true,
            cached: result.cached,
            source: result.source,
            location: result.location,
        });
    } catch (err) {
        console.error('Author birthplace error:', err);
        if (err && /Book not found/.test(err.message)) {
            return res.status(404).json({ success: false, error: 'Book not found' });
        }
        return res.status(500).json({
            success: false,
            error: 'Failed to resolve author birthplace',
            details: err && err.message ? err.message : String(err),
        });
    }
});

app.post('/api/books/:id/enrich', async (req, res) => {
    const { id } = req.params;
    try {
        const existing = await Book.findById(id).lean();
        if (!existing) {
            return res.status(404).json({ error: 'Book not found' });
        }

        const missing = detectMissingFields(existing);
        if (!missing.length) {
            return res.json({
                success: true,
                alreadyComplete: true,
                message: 'All book data is already complete',
                book: existing,
                updatedFields: [],
                missingFields: [],
            });
        }

        const result = await enrichBookData({ _id: id });
        console.log(`[enrich] /api/books/${id}/enrich → updated=${JSON.stringify(result.updatedFields)} missing=${JSON.stringify(result.missingFields)} source=${result.source}`);
        return res.json({
            success: true,
            alreadyComplete: false,
            message: result.updatedFields.length
                ? 'Book data enriched successfully'
                : 'LLM did not return enough confident data to update fields',
            book: result.book,
            updatedFields: result.updatedFields,
            missingFields: result.missingFields,
            source: result.source,
        });
    } catch (err) {
        console.error('Enrich book error:', err);
        return res.status(500).json({
            success: false,
            error: 'Failed to enrich book data',
            details: err && err.message ? err.message : String(err),
        });
    }
});

app.post('/save-book', checkAuthenticated, async (req, res) => {
    const { bookId } = req.body;

    try {
        const book = await Book.findById(bookId);
        if (!book) {
            return res.status(404).json({ message: 'Book not found' });
        }

        const user = await User.findById(req.user._id);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        if (user.savedBooks.includes(bookId)) {
            return res.status(200).json({ message: 'Book already saved' });
        }

        user.savedBooks.push(bookId);
        await user.save();

        console.log(`Book ${bookId} saved for user ${user._id}`);
        res.json({ message: 'Book saved successfully' });
    } catch (err) {
        console.error('Error saving book:', err);
        res.status(500).json({ message: 'Error saving book' });
    }
});

app.get('/user-saved-books', async (req, res) => {
  const { userId } = req.params;

  try {
    const user = await User.findById(userId).populate('savedBooks');
    if (!user) return res.status(404).send('Користувача не знайдено');

    res.render('savedBooks', { user, books: user.savedBooks });
  } catch (err) {
    res.status(500).send('Помилка при завантаженні книг');
  }
});

app.delete('/delete-book/:bookId', checkAuthenticated, async (req, res) => {
    const { bookId } = req.params;

    try {
        const user = await User.findById(req.user._id);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        user.savedBooks = user.savedBooks.filter(id => id.toString() !== bookId);
        await user.save();

        console.log(`Book ${bookId} removed from user ${user._id}'s saved books`);
        res.json({ message: 'Book removed successfully' });
    } catch (err) {
        console.error('Error removing book:', err);
        res.status(500).json({ message: 'Error removing book' });
    }
});

app.get('/recommendations', checkAuthenticated, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 8;
        const skip = (page - 1) * limit;

        const user = await User.findById(req.user._id).populate('savedBooks');
        let books = [];
        let totalBooks = 0;
        let message = '';
        let savedBookIds = [];

        if (user && user.savedBooks) {
            savedBookIds = user.savedBooks.map(book => book._id.toString());
            console.log('User has saved books:', user.savedBooks.length);
        }

        if (!user || !user.savedBooks || user.savedBooks.length === 0) {
            console.log('No saved books, getting random recommendations');
            books = await Book.aggregate([
                { $sample: { size: limit } }
            ]);
            books = await Book.populate(books, { path: '_id' });
            totalBooks = await Book.countDocuments();
            message = "Random recommendations (since you don't have any saved books yet)";
        } else {
            try {
                console.log('Getting personalized recommendations');
                const userProfile = modelHandler.preprocessUserProfile(user.savedBooks);
                console.log('User profile created');
                
                const recommendedIndices = await modelHandler.getRecommendations(userProfile);
                console.log('Recommended indices:', recommendedIndices);

                books = await Book.find({
                    bookIndex: { $in: recommendedIndices },
                    _id: { $nin: savedBookIds }
                })
                .skip(skip)
                .limit(limit)
                .sort({ title: 1 });

                console.log('Found books by bookIndex:', books.length);

                if (books.length < limit) {
                    console.log('Not enough books found by index, adding category-based recommendations');
                    const categoryBooks = await Book.find({
                        _id: { $nin: [...savedBookIds, ...books.map(b => b._id)] },
                        categories: { 
                            $in: user.savedBooks.flatMap(book => 
                                book.categories ? 
                                    (Array.isArray(book.categories) ? book.categories : book.categories.split(',').map(c => c.trim())) 
                                    : []
                            )
                        }
                    })
                    .limit(limit - books.length)
                    .sort({ average_rating: -1 });

                    books = [...books, ...categoryBooks];
                    console.log('Added category-based books:', categoryBooks.length);
                }

                if (books.length < limit) {
                    console.log('Still need more books, adding random recommendations');
                    const randomBooks = await Book.aggregate([
                        { 
                            $match: { 
                                _id: { 
                                    $nin: [...savedBookIds, ...books.map(b => b._id)]
                                }
                            }
                        },
                        { $sample: { size: limit - books.length } }
                    ]);
                    const populatedRandomBooks = await Book.populate(randomBooks, { path: '_id' });
                    books = [...books, ...populatedRandomBooks];
                }

                totalBooks = await Book.countDocuments({ _id: { $nin: savedBookIds } });
                message = books.length === limit ? 
                    "Personalized recommendations based on your saved books" :
                    "Mixed recommendations based on your preferences and popular books";

            } catch (modelError) {
                console.error('Error getting recommendations from model:', modelError);
                books = await Book.aggregate([
                    { $match: { _id: { $nin: savedBookIds } } },
                    { $sample: { size: limit } }
                ]);
                books = await Book.populate(books, { path: '_id' });
                totalBooks = await Book.countDocuments();
                message = "Random recommendations (recommendation system error)";
            }
        }

        const totalPages = Math.ceil(totalBooks / limit);

        console.log('Final books count:', books.length);
        console.log('Sample book data:', books[0]);

        res.render('recommendations', {
            books,
            currentPage: page,
            totalPages,
            totalBooks,
            savedBookIds,
            message,
            user: {
                name: user.name,
                id: user._id
            }
        });

    } catch (error) {
        console.error('Error in recommendations route:', error);
        res.status(500).render('error', {
            message: 'Error getting recommendations'
        });
    }
});

app.get('/api/recommendations', async (req, res) => {
    const titleQ = req.query.title;
    if (titleQ !== undefined && String(titleQ).trim() !== '') {
        req.query.title = String(titleQ).trim();
        return getMlRecommendationsByTitle(req, res);
    }
    if (!req.isAuthenticated || !req.isAuthenticated()) {
        return res.status(401).json({ error: 'Login required' });
    }
    try {
        const user = await User.findById(req.user._id).populate('savedBooks');
        
        if (!user || !user.savedBooks || user.savedBooks.length === 0) {
            const randomBooks = await Book.aggregate([{ $sample: { size: 5 } }]);
            return res.json({
                books: randomBooks,
                type: 'random'
            });
        }

        const userProfile = modelHandler.preprocessUserProfile(user.savedBooks);
        const recommendedIndices = await modelHandler.getRecommendations(userProfile);
        const recommendedBooks = await Book.find({
            bookIndex: { $in: recommendedIndices }
        });

        res.json({
            books: recommendedBooks,
            type: 'personalized'
        });

    } catch (error) {
        console.error('Error getting recommendations:', error);
        res.status(500).json({ 
            error: 'Failed to generate recommendations'
        });
    }
});

function checkAuthenticated(req, res, next) {
    if (req.isAuthenticated()) return next();
    res.redirect("/login");
}

function checkNotAuthenticated(req, res, next) {
    if (req.isAuthenticated()) return res.redirect("/home");
    next();
}

app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});
