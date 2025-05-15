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

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/book-recommender', {
    dbName: 'book-recommender' // Explicitly set database name
})
    .then(() => console.log("✅ MongoDB connected to book-recommender database"))
    .catch(err => console.error("❌ MongoDB connection error:", err));

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
app.get("/recommender", (req, res) => res.render("recommender"));
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
  
        // Get total books count and books for current page
        const totalBooks = await Book.countDocuments(filter);
        const totalPages = Math.ceil(totalBooks / limit);
        const books = await Book.find(filter).skip(skip).limit(limit);

        // If user is authenticated, get their saved books to mark which ones are already saved
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

        // Check if book is saved if user is authenticated
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
        // Find the book first
        const book = await Book.findById(bookId);
        if (!book) {
            return res.status(404).json({ message: 'Book not found' });
        }

        // Find the user
        const user = await User.findById(req.user._id);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Check if book is already saved
        if (user.savedBooks.includes(bookId)) {
            return res.status(200).json({ message: 'Book already saved' });
        }

        // Add book to saved books
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
        // Find the user
        const user = await User.findById(req.user._id);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Remove book from saved books
        user.savedBooks = user.savedBooks.filter(id => id.toString() !== bookId);
        await user.save();

        console.log(`Book ${bookId} removed from user ${user._id}'s saved books`);
        res.json({ message: 'Book removed successfully' });
    } catch (err) {
        console.error('Error removing book:', err);
        res.status(500).json({ message: 'Error removing book' });
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
