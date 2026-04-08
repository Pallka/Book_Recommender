const { name } = require("ejs");
const mongoose = require("mongoose");
const { Schema, model, Types } = mongoose;

/** Opens Mongo and registers User, Book, SearchHistory, AiInteraction (also opened from server.js). */
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/book-recommender', {
    dbName: 'book-recommender'
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
        default: '/images/default-book.jpg'
    },
    description: {
        type: String,
        default: true
    },
    categories: {
        type: String,
        default: true
    },
    publishedDate: {
        type: String,
        default: ''
    },
    published_year: {
        type: Number,
        default: true
    },
    average_rating: {
        type: Number,
        default: true
    },
    num_pages: {
        type: Number,
        default: true
    },
    ratings_count: {
        type: Number,
        default: true
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
    meta: { type: mongoose.Schema.Types.Mixed, default: {} }
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

        // Book model uses collection `books7k`; legacy bootstrap still creates `books` if missing.
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
