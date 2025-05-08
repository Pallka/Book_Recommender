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

app.get("/home", checkAuthenticated, (req, res) => {
    res.render("home", { name: req.user.name });
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
    const page       = parseInt(req.query.page)  || 1;
    const limit      =  12;
    const skip       = (page - 1) * limit;
    const searchTerm = (req.query.search || '').trim();
  
    // пошук
    const filter = searchTerm
      ? {
          $or: [
            { title:  new RegExp(searchTerm, 'i') },
            { author: new RegExp(searchTerm, 'i') }
          ]
        }
      : {};
  
    try {
      const totalBooks = await Book.countDocuments(filter);
      const totalPages = Math.ceil(totalBooks / limit);
      const books      = await Book
                               .find(filter)
                               .skip(skip)
                               .limit(limit);
  
      return res.render('books', {
        books,
        currentPage: page,
        totalPages,
        totalBooks,
        searchTerm
      });
    } catch (err) {
      console.error('Books fetch error:', err);
      return res.status(500).send('Internal Server Error');
    }
});

app.get('/books/:id', async (req, res) => {
    try {
      const book = await Book.findById(req.params.id);
      if (!book) return res.status(404).send('Book not found');
      res.render('book-details', { book });
    } catch (err) {
      res.status(500).send('Server error');
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
