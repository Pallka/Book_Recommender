# Book Recommender 2025

A modern web application for book recommendations using machine learning, built with Node.js, Express, MongoDB, and TensorFlow.js.

## 📚 Project Overview

Book Recommender 2025 is an intelligent book recommendation system that uses machine learning to provide personalized book suggestions based on user preferences and reading history. The system analyzes user behavior, book categories, and reading patterns to deliver accurate recommendations.

## Project Structure

```
book-recommender/
├── server.js                 # Main application entry point
├── config.js                 # Configuration settings and database models
├── passport-config.js        # Authentication configuration
├── model/
│   └── modelHandler.js       # ML model implementation and management
├── views/
│   ├── partials/            # Reusable EJS components
│   │   ├── header.ejs       # Common header component
│   │   └── footer.ejs       # Common footer component
│   ├── css/                 # Stylesheet directory
│   ├── images/              # Static images
│   ├── about.ejs            # About page template
│   ├── book-details.ejs     # Individual book view
│   ├── books.ejs            # Book listing page
│   ├── error.ejs           # Error page template
│   ├── home.ejs            # User dashboard
│   ├── index.ejs           # Landing page
│   ├── login.ejs           # Login page
│   ├── recommendations.ejs  # Book recommendations page
│   ├── register.ejs        # User registration page
│   └── register_success.ejs # Registration success page
├── package.json             # Project dependencies and scripts
└── package-lock.json        # Locked dependency versions
```

## 📄 File Descriptions

### Core Files
- `server.js`: Main application file that initializes Express, sets up middleware, and defines routes
- `config.js`: Contains database models (User, Book) and application configuration
- `passport-config.js`: Implements authentication strategies using Passport.js

### Model
- `modelHandler.js`: Implements the TensorFlow.js recommendation model with:
  - Neural network architecture (3 layers with dropout)
  - User profile preprocessing
  - Book category management
  - Recommendation generation logic

### Views
- EJS templates for all pages with responsive design
- Partial components for code reusability
- Static assets (CSS, images)

## Prerequisites

- Node.js (v14.0.0 or higher)
- MongoDB (v4.4 or higher)
- npm (v6.0.0 or higher)
- Git

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/book-recommender.git
cd book-recommender
```

2. Install dependencies:
```bash
npm install
```

3. Create a .env file in the root directory:
```env
NODE_ENV=development
MONGO_URI=mongodb://localhost:27017/book-recommender
SECRET_KEY=your_secret_key_here
```

4. Initialize the database:
```bash
# Start MongoDB service
mongod

# In a new terminal, connect to MongoDB
mongosh
```

5. Start the development server:
```bash
npm run devStarts
```

## Usage

### User Registration and Login
1. Navigate to http://localhost:3000
2. Click "Register" to create a new account
3. Log in with your credentials

### Book Recommendations
1. Browse the book catalog
2. Save books to your profile
3. Receive personalized recommendations based on your preferences
4. View detailed book information

### Managing Your Profile
1. View saved books on your dashboard
2. Update reading preferences
3. Track reading history

## Development

### Environment Setup
1. Install development dependencies:
```bash
npm install --save-dev nodemon dotenv
```

2. Configure MongoDB:
- Create the database:
```bash
use book-recommender
```
- Import initial book data (if available):
```bash
mongoimport --db book-recommender --collection books --file path/to/books.json
```

### Running Tests
```bash
npm test
```

### Debugging
1. Server-side debugging:
   - Use console.log statements for basic debugging
   - Check server logs in the terminal
   - Monitor MongoDB operations

2. Client-side debugging:
   - Use browser developer tools
   - Check browser console for errors
   - Monitor network requests

## Machine Learning Model

The recommendation system uses a neural network with:
- Input layer: 2003 nodes (book indices + categories)
- Hidden layers:
  - Dense layer (512 units, ReLU activation)
  - Dropout layer (30%)
  - Dense layer (256 units, ReLU activation)
  - Dropout layer (20%)
- Output layer: 567 nodes (softmax activation)

### Model Features
- User profile vectorization
- Category encoding
- Real-time predictions
- Memory management with tensor disposal

## Security Features

1. Password Security:
   - Bcrypt hashing
   - Salted passwords
   - Secure session management

2. Authentication:
   - Passport.js local strategy
   - Session-based authentication
   - Protected routes

3. Data Protection:
   - Input validation
   - XSS protection
   - CSRF protection

## API Endpoints

### Authentication
- POST /login
- POST /register
- DELETE /logout

### Books
- GET /books
- GET /books/:id
- POST /save-book

### Recommendations
- GET /recommendations

## UI/UX Features

1. Responsive Design:
   - Bootstrap 5.3.3
   - Mobile-first approach
   - Adaptive layouts

2. User Interface:
   - Modern card-based design
   - Interactive elements
   - Loading states
   - Error handling

3. Accessibility:
   - ARIA labels
   - Semantic HTML
   - Keyboard navigation

## Troubleshooting

### Common Issues

1. MongoDB Connection:
```bash
# Check MongoDB service
sudo service mongodb status

# Restart MongoDB
sudo service mongodb restart
```

2. Node.js Errors:
```bash
# Clear npm cache
npm cache clean --force

# Reinstall dependencies
rm -rf node_modules
npm install
```

3. Model Initialization:
- Check TensorFlow.js compatibility
- Verify model parameters
- Monitor memory usage

## 📈 Performance Optimization

1. Database:
   - Indexed queries
   - Efficient data structures
   - Cached responses

2. Machine Learning:
   - Batch processing
   - Memory management
   - Optimized tensor operations

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit changes
4. Push to the branch
5. Open a pull request

## Author

- Kateryna Palka
