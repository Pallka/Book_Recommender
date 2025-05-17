require('dotenv').config();
const mongoose = require('mongoose');
const { Book } = require('../config');

async function updateBookIndices() {
    try {
        await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/book-recommender', {
            dbName: 'book-recommender'
        });
        console.log('✅ Connected to MongoDB');

        const books = await Book.find({ bookIndex: { $exists: false } }).sort({ title: 1 });
        console.log(`Found ${books.length} books without indices`);

        const highestIndexBook = await Book.findOne({ bookIndex: { $exists: true } })
            .sort({ bookIndex: -1 });
        let startIndex = highestIndexBook ? highestIndexBook.bookIndex + 1 : 0;

        for (const book of books) {
            await Book.findByIdAndUpdate(book._id, { bookIndex: startIndex });
            console.log(`Updated book "${book.title}" with index ${startIndex}`);
            startIndex++;
        }

        console.log('✅ Successfully updated all book indices');
    } catch (error) {
        console.error('❌ Error updating book indices:', error);
    } finally {
        await mongoose.connection.close();
        console.log('Closed MongoDB connection');
    }
}

updateBookIndices(); 