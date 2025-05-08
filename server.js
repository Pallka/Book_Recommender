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
const { MongoClient, ObjectId } = require("mongodb");
const initializePassport = require("./passport-config");
let collection = require("./config");

const uri = process.env.MONGO_URI;
const client = new MongoClient(uri);

async function connectToDB() {
    try {
        await client.connect();
        const db = client.db("book-recommender");
        collection = db.collection("users");
        console.log("✅ MongoDB connected");
    } catch (err) {
        console.error("❌ MongoDB connection error:", err);
    }
}
connectToDB();

initializePassport(
    passport,
    async email => await collection.findOne({ email }),
    async id => await collection.findOne({ _id: new ObjectId(id) })
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
    failureRedirect: "/login",
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
        const existingUser  = await collection.findOne({ email: data.email });
        if (existingUser ) {
            req.flash("error", "User  already exists");
            return res.redirect("/register");
        }
        const hashedPassword = await bcrypt.hash(data.password, 10);
        data.password = hashedPassword;
        await collection.insertOne(data);
        res.render("register_success");
    } catch (error) {
        console.error("Signup error:", error);
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
app.get("/books", (req, res) => res.render("books"));
app.get("/register_seccess", (req, res) => res.render("register_seccess"));
app.get("/error", (req, res) => res.render("error"));

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
