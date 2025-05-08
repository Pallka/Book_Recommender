const { name } = require("ejs"); 
const mongoose = require("mongoose");

// Connecting to MongoDB with explicit database name
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/book-recommender', {
    dbName: 'book-recommender' // Explicitly set database name
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
    }
}, {
    collection: 'users',
    timestamps: true
});

// Define the Book schema
const BookSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true
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
    published_year: {
        type: String,
        default: true
    },
}, {
    collection: 'books7k',
    timestamps: true
});

// Create models
const User = mongoose.model("users", LoginSchema);
const Book = mongoose.model('Book', BookSchema);

// Verify collections exist
mongoose.connection.on('connected', async () => {
    try {
        const collections = await mongoose.connection.db.listCollections().toArray();
        const collectionNames = collections.map(c => c.name);
        console.log("Available collections:", collectionNames);
        
        if (!collectionNames.includes('users')) {
            console.log("Creating users collection...");
            await mongoose.connection.createCollection('users');
            console.log("Users collection created successfully");
        }
        
        if (!collectionNames.includes('books7k')) {
            console.log("Creating books collection...");
            await mongoose.connection.createCollection('books');
            console.log("Books collection created successfully");
        }
    } catch (error) {
        console.error("Error checking/creating collection:", error);
    }
});

// Export both models
module.exports = {
    User,
    Book
};
