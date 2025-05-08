if(process.env.NODE_ENV !== "production") {
    require("dotenv").config()
}

const express = require("express")
const app = express()
const bcrypt = require("bcrypt")
const initializePassport = require("./passport-config")
const passport = require("passport")
const flash = require("express-flash")
const session = require("express-session")
const methodOverride = require("method-override")

// Set EJS as the view engine
app.set('view engine', 'ejs')
app.set('views', './views')

initializePassport(
    passport,
    email => users.find(user => user.email === email),
    id => users.find(user => user.id == id)
)

const PORT = 3000

const users = []

app.use(express.static('views'))

app.use(express.urlencoded({extended: false}))
app.use(flash())
app.use(session({
    secret: process.env.SECRET_KEY,
    resave: false,
    saveUninitialized: false
}))
app.use(passport.initialize())
app.use(passport.session())
app.use(methodOverride("_method"))

// Add middleware to make flash messages available to all views
app.use((req, res, next) => {
    res.locals.error = req.flash('error')
    res.locals.success = req.flash('success')
    next()
})

app.post('/login', checkNotAuthenticated, passport.authenticate("local", {
    successRedirect: "/home",
    failureRedirect: "/login",
    failureFlash: true
}))

app.post('/register', checkNotAuthenticated, async(req, res) => {
    try{
        const hashedPassword = await bcrypt.hash(req.body.password, 10)
        users.push({
            id: Date.now().toString(), //get random number
            name: req.body.name,
            email: req.body.email,
            password: hashedPassword
        })
        console.log(users);
        res.redirect('/login')
    } catch  {
        console.log(e);
        res.redirect('/register')
    }
})

//routes
app.get('/', (req, res) => {
    res.render("index.ejs")
})

app.get('/login', checkNotAuthenticated, (req, res) => {
    res.render("login.ejs")
})

app.get('/register', checkNotAuthenticated, (req, res) => {
    res.render("register.ejs")
})

app.get('/about', (req, res) => {
    res.render("about.ejs")
})

app.get('/home', checkAuthenticated, (req, res) => {
    res.render("home.ejs", {name: req.user.name})
})

app.get('/recommender', (req, res) => {
    res.render("recommender.ejs")
})

app.get('/books', (req, res) => {
    res.render("books.ejs")
})

//end routes
app.delete('/logout', (req, res) => {
    req.logout(req.user, err => {
        if (err) return next(err)
        res.redirect('/home')
    })
})

//some function
function checkAuthenticated(req, res, next){
    if(req.isAuthenticated()){
        return next()
    }
    res.redirect("/login")
}

function checkNotAuthenticated(req, res, next){
    if(req.isAuthenticated()){
        return res.redirect("/home")
    }
    return next()
}

app.listen(PORT)