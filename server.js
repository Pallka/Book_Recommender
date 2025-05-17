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
const { User, Book } = require("./config");
const modelHandler = require('./model/modelHandler');

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/book-recommender', {
    dbName: 'book-recommender' // Explicitly set database name
})
    .then(() => console.log("✅ MongoDB connected to book-recommender database"))
    .catch(err => console.error("❌ MongoDB connection error:", err));

// Add this after MongoDB connection
modelHandler.loadModel()
    .then(() => console.log('✅ Model initialized successfully'))
    .catch(err => console.error('❌ Model initialization error:', err));

initializePassport(
    passport,
    async email => await User.findOne({ email }),
    async id => await User.findById(id)
);

const PORT = 3000;

app.set("view engine", "ejs");
app.set("views", "./views");
app.use(express.static("views"));
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
        // Find user and populate their saved books
        const user = await User.findById(req.user._id).populate('savedBooks');
        
        // Pass both user name and saved books to the template
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
app.get("/register_seccess", (req, res) => res.render("register_seccess"));
app.get("/error", (req, res) => res.render("error"));

app.get('/books', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = 12;
    const skip = (page - 1) * limit;
    const searchTerm = (req.query.search || '').trim();
  
    try {
        // Create search filter
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
                    _id: { $nin: savedBookIds } // Exclude already saved books
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

app.get('/api/recommendations', checkAuthenticated, async (req, res) => {
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
