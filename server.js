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

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/book-recommender', {
    dbName: 'book-recommender'
})
    .then(() => console.log("✅ MongoDB connected to book-recommender database"))
    .catch(err => console.error("❌ MongoDB connection error:", err));

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

// Sync Google Books -> MongoDB + Qdrant
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

/** Allows request if INTERNAL_API_KEY is unset; else requires header or query match. */
function internalKeyOk(req) {
    if (!INTERNAL_API_KEY) return true;
    const k = req.headers["x-internal-key"] || req.query.internal_key;
    return k === INTERNAL_API_KEY;
}

/** POST /api/ai/chat: try Python service (AI_SERVICE_URL), then LLM chain (Groq/OpenAI/Ollama), else keyword replies. */
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

        try {
            const chatUrl = `${AI_SERVICE_URL}/chat`;
            const ac = new AbortController();
            const t = setTimeout(() => ac.abort(), 120000);
            const pyRes = await fetch(chatUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    user_input: message,
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
                    try {
                        await SearchHistory.create({ user_id: userId || undefined, query: message });
                        await AiInteraction.create({
                            user_id: userId || undefined,
                            query: message,
                            response: reply,
                            meta: { explanation, semantic_hits, ml_books, source: "python" }
                        });
                    } catch (e) { console.warn("AiInteraction save:", e.message); }
                    return res.json({
                        reply,
                        explanation,
                        recommendations: { semantic: semantic_hits, ml: ml_books }
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
            "Format every reply in Markdown: use a blank line between paragraphs; for lists put each item on its own line starting with \"- \" (hyphen and space). " +
            "Do not run list items together on one line with asterisks.";

        let llmOut = null;
        try {
            llmOut = await tryLlmChat({ systemPrompt, history, message });
        } catch (e) {
            console.warn("LLM fallback chain error:", e.message);
        }
        if (llmOut && llmOut.text) {
            try {
                await AiInteraction.create({
                    user_id: userId || undefined,
                    query: message,
                    response: llmOut.text,
                    meta: { source: llmOut.source || "llm" }
                });
            } catch (e) { /* ignore */ }
            return res.json({ reply: llmOut.text });
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

        return res.json({ reply });
    } catch (err) {
        console.error("AI chat error:", err);
        return res.status(500).json({ error: "AI chat failed" });
    }
});

/** Books list for Python / Qdrant indexing (protected when INTERNAL_API_KEY is set). */
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

/**
 * JSON ML recommendations for a seed title (internal or same key as /api/sync-books).
 * Resolves one book by case-insensitive title regex, runs TF model, returns up to 20 books by bookIndex.
 */
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

/** OPENAI_API_KEY from env, trimmed; strips wrapping quotes from .env mistakes. */
function openaiApiKey() {
    const raw = process.env.OPENAI_API_KEY;
    if (!raw) return "";
    return String(raw).trim().replace(/^['"]|['"]$/g, "");
}

/** GROQ_API_KEY from env, trimmed (same rules as openaiApiKey). */
function groqApiKey() {
    const raw = process.env.GROQ_API_KEY;
    if (!raw) return "";
    return String(raw).trim().replace(/^['"]|['"]$/g, "");
}

/** Builds OpenAI-style messages[]: system + last user/assistant turns + current user message. */
function buildLlmMessages(systemPrompt, history, message) {
    return [
        { role: "system", content: systemPrompt },
        ...history
            .filter(m => m && typeof m === "object" && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
            .map(m => ({ role: m.role, content: m.content })),
        { role: "user", content: message }
    ];
}

/**
 * POST {baseUrl}/chat/completions (OpenAI-compatible API).
 * @param {{ baseUrl: string, apiKey: string, model: string, messages: object[] }} opts — baseUrl ends with /v1; apiKey may be "" for Ollama.
 * @returns {Promise<string>} Assistant message text.
 * @throws If HTTP non-OK or empty choices[0].message.content.
 */
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

/**
 * Calls one or more chat providers per LLM_PROVIDER (env).
 * auto: Groq (if GROQ_API_KEY) → OpenAI (if OPENAI_API_KEY) → Ollama (local, no key).
 * Stops on first non-empty reply.
 * @returns {Promise<{ text: string, source: string }|null>} null if no providers were tried (e.g. LLM_PROVIDER=groq but no key) or none returned text without throwing.
 * @throws The last error from the chain if every attempt threw (caller logs and falls back to keyword replies only when this is caught).
 */
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
    const page = parseInt(req.query.page) || 1;
    const limit = 12;
    const skip = (page - 1) * limit;
    const searchTerm = (req.query.search || '').trim();
  
    try {
        const filter = searchTerm ? {
            $or: [
                { title: new RegExp(searchTerm, 'i') },
                { authors: new RegExp(searchTerm, 'i') }
            ]
        } : {};
  
        const totalBooks = await Book.countDocuments(filter);
        const totalPages = Math.ceil(totalBooks / limit);
        const books = await Book.find(filter).skip(skip).limit(limit);

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
            searchTerm,
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
