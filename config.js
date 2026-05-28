const fs = require("fs");
const mongoose = require("mongoose");
const { Schema, model, Types } = mongoose;

/** Docker/host: `/.dockerenv`, cgroup hints, or RUNNING_IN_DOCKER=1 (compose). */
function isRunningInsideDocker() {
    if (process.env.RUNNING_IN_DOCKER === "1" || process.env.RUNNING_IN_DOCKER === "true") {
        return true;
    }
    try {
        if (fs.existsSync("/.dockerenv")) return true;
    } catch { /* ignore */ }
    try {
        if (fs.existsSync("/proc/1/cgroup")) {
            const cg = fs.readFileSync("/proc/1/cgroup", "utf8");
            if (/docker|containerd|kubepods/i.test(cg)) return true;
        }
    } catch { /* ignore */ }
    return false;
}

/** Replace `mongodb://mongo` with 127.0.0.1 when the process runs on the host, not in Docker. */
function resolveMongoUriForProcess(uri) {
    if (!uri || typeof uri !== "string") return uri;
    try {
        if (!/^mongodb:\/\/mongo\b/i.test(uri)) return uri;
        if (isRunningInsideDocker()) return uri;
        return uri.replace(/^mongodb:\/\/mongo\b/i, "mongodb://127.0.0.1");
    } catch {
        return uri;
    }
}

if (!process.env.MONGO_URI) {
    process.env.MONGO_URI =
        process.env.NODE_ENV === "production"
            ? "mongodb://mongo:27017/book-recommender"
            : "mongodb://localhost:27017/book-recommender";
}
process.env.MONGO_URI = resolveMongoUriForProcess(process.env.MONGO_URI);

console.log(
    `[mongo] connecting → ${process.env.MONGO_URI} (inDocker=${isRunningInsideDocker()})`
);

mongoose.connect(process.env.MONGO_URI, {
    dbName: "book-recommender"
})
    .then(() => {
        console.log("✅ MongoDB connected successfully");
        console.log("Database name:", mongoose.connection.db.databaseName);
    })
    .catch(err => {
        console.error("❌ MongoDB connection error:", err);
    });

const LoginSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true 
    },
    email: {
        type: String,
        required: true,
        unique: true
    },
    password: {
        type: String,
        required: true 
    },
    savedBooks: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Book'
    }]
}, {
    collection: 'users',
    timestamps: true
});

const BookSchema = new mongoose.Schema({
    isbn13: {
        type: String,
        unique: true,
        required: true
    },
    bookIndex: {
        type: Number,
        unique: true,
        sparse: true 
    },
    title: {
        type: String,
        required: true
    },
    googleId: {
        type: String,
        unique: true,
        sparse: true
    },
    googleBooksId: {
        type: String,
        index: true
    },
    googleBooksUpdatedAt: {
        type: Date
    },
    googleBooksNotFound: {
        type: Boolean,
        default: false
    },
    olid: {
        type: String,
        unique: true,
        sparse: true
    },
    authors: {
        type: String,
        required: true
    },
    thumbnail: {
        type: String,
        default: '/images/no-cover.svg'
    },
    description: {
        type: String
    },
    coverImage: {
        type: String
    },
    categories: {
        type: [{ type: String }],
        default: []
    },
    publishedDate: {
        type: String
    },
    published_year: {
        type: Number
    },
    average_rating: {
        type: Number
    },
    averageRating: {
        type: Number
    },
    num_pages: {
        type: Number
    },
    ratings_count: {
        type: Number
    },
    ratingsCount: {
        type: Number
    },
    pageCount: {
        type: Number
    },
    isClassic: {
        type: Boolean,
        default: false
    },
    isModern: {
        type: Boolean,
        default: false
    },
    timeline: {
        type: [{
            year: { type: Number, required: true },
            title: { type: String, required: true },
            description: { type: String, default: '' },
            _id: false,
        }],
        default: undefined,
    },
    timelineGeneratedAt: {
        type: Date,
        default: undefined,
    },
    timelinePromptVersion: {
        type: Number,
        default: 0,
    },
    authorBirthplace: {
        authorName: { type: String, default: '' },
        city: { type: String, default: '' },
        country: { type: String, default: '' },
        birthYear: { type: Number },
        latitude: { type: Number },
        longitude: { type: Number },
        confidence: { type: String, default: '' },
        source: { type: String, default: '' },
        generatedAt: { type: Date },
    },
    authorBirthplaceCheckedAt: {
        type: Date,
    },
    authorBirthplaceVersion: {
        type: Number,
        default: 0,
    },
}, {
    collection: 'books7k',
    timestamps: true
});

const SearchHistorySchema = new mongoose.Schema({
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'users', default: null },
    query: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
}, { collection: 'search_history' });

const AiInteractionSchema = new mongoose.Schema({
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'users', default: null },
    query: { type: String, required: true },
    response: { type: String, default: '' },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
    feedback: { type: String, enum: ['like', 'dislike'], default: undefined },
    feedbackAt: { type: Date, default: undefined }
}, { collection: 'ai_interactions', timestamps: true });

const User = mongoose.model("users", LoginSchema);
const Book = mongoose.model('Book', BookSchema);
const SearchHistory = mongoose.model('SearchHistory', SearchHistorySchema);
const AiInteraction = mongoose.model('AiInteraction', AiInteractionSchema);

mongoose.connection.on('connected', async () => {
    try {
        const collections = await mongoose.connection.db.listCollections().toArray();
        const collectionNames = collections.map(c => c.name);
        console.log("Available collections:", collectionNames);

        if (!collectionNames.includes('users')) {
            await mongoose.connection.createCollection('users');
            console.log("Created collection: users");
        }

        if (!collectionNames.includes('books7k')) {
            await mongoose.connection.createCollection('books');
            console.log("Created collection: books");
        }
    } catch (error) {
        console.error("Error checking/creating collection:", error);
    }
});

module.exports = {
    User,
    Book,
    SearchHistory,
    AiInteraction
};
