const { name } = require("ejs"); 
const mongoose = require("mongoose");

// Connecting to MongoDB
const connect = mongoose.connect(process.env.MONGO_URI) 

const LoginSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true 
    },
    password: {
        type: String,
        required: true 
    }
});

const collection = new mongoose.model("users", LoginSchema);

module.exports = collection;