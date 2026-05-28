# Book Recommender

A modern web application for book recommendations using machine learning, built with Node.js, Express, MongoDB, and TensorFlow.js. It also includes an AI assistant (semantic search via Qdrant and OpenAI), LLM-powered book enrichment, historical timelines, and an author birthplace map (Leaflet).

**Repository:** https://github.com/Pallka/Book_Recommender

## 📚 Project Overview

Book Recommender 2025 is an intelligent book recommendation system that uses machine learning to provide personalized book suggestions based on user preferences and reading history. The system analyzes user behavior, book categories, and reading patterns to deliver accurate recommendations.

In addition to the TensorFlow.js model, the application offers:

- **AI chat widget** — floating assistant with book cards, chat history in `localStorage`, and like/dislike feedback
- **Semantic book search** — Python `ai-service` (FastAPI) with Qdrant vector store and OpenAI embeddings
- **Book enrichment** — LLM fills missing metadata (Claude or Ollama)
- **Historical timeline** — contextual events for a book’s publication period
- **Author map** — Leaflet map of the author’s birthplace (coordinates from LLM)
- **Catalog sync** — scripts import books from external APIs into MongoDB and Qdrant

## Project Structure

```
Book_Recommender/
├── server.js                 # Main application entry point (routes, AI proxy, APIs)
├── config.js                 # MongoDB models and Docker-aware connection
├── passport-config.js        # Authentication configuration
├── docker-compose.yml        # MongoDB, Qdrant, ai-service, Node app
├── Dockerfile                # Node application image
├── model/
│   └── modelHandler.js       # TensorFlow.js recommendation model
├── services/                 # Node LLM helpers
│   ├── llm.js                # OpenAI-compatible LLM client (Claude / Ollama)
│   ├── bookEnrichment.js     # Enrich book fields via LLM
│   ├── bookTimeline.js       # Historical timeline generation
│   └── authorBirthplace.js   # Author birthplace for map
├── scripts/
│   ├── syncBooks.js          # Sync books → MongoDB + Qdrant embeddings
│   ├── importNew.js          # Import new books only
│   ├── updateExisting.js     # Update existing catalog records
│   ├── updateBookIndices.js  # Refresh book indices for ML model
│   └── run.js                # Run full sync pipeline
├── ai-service/
│   ├── main.py               # FastAPI: semantic search + OpenAI chat
│   ├── Dockerfile
│   └── requirements.txt
├── backend/                  # Optional LangGraph ReAct API (separate deploy)
│   ├── main.py
│   ├── ai_agent/             # LangGraph agent, tools, context
│   ├── routes/               # books, chat
│   └── services/             # Mongo, Qdrant, embeddings, LLM
├── views/
│   ├── partials/
│   │   ├── header.ejs
│   │   ├── footer.ejs
│   │   ├── ai_widget.ejs     # AI chat modal UI
│   │   └── book-thumbnail.ejs
│   ├── js/
│   │   └── ai-agent.js       # Chat client logic
│   ├── css/
│   ├── images/
│   ├── about.ejs
│   ├── book-details.ejs      # Details, timeline, map, Enrich with AI
│   ├── books.ejs
│   ├── error.ejs
│   ├── faqs.ejs
│   ├── home.ejs
│   ├── index.ejs
│   ├── login.ejs
│   ├── recommendations.ejs
│   ├── register.ejs
│   └── register_success.ejs
├── sample_ai_agent/
│   └── robot_svg.svg         # AI widget avatar
├── screenshots/              # UI screenshots for documentation
├── package.json
└── package-lock.json
```

## 📄 File Descriptions

### Core Files
- `server.js`: Main application file that initializes Express, sets up middleware, defines routes, proxies AI chat to `ai-service`, and exposes book enrichment/timeline/map APIs
- `config.js`: Contains database models (`User`, `Book`, `SearchHistory`, `AiInteraction`) and Docker-aware `MONGO_URI` handling
- `passport-config.js`: Implements authentication strategies using Passport.js

### Model
- `modelHandler.js`: Implements the TensorFlow.js recommendation model with:
  - Neural network architecture (3 layers with dropout)
  - User profile preprocessing
  - Book category management
  - Recommendation generation logic

### Services (Node.js)
- `llm.js`: Shared LLM client (Anthropic Claude or Ollama via OpenAI-compatible API)
- `bookEnrichment.js`: Fills missing book fields using structured LLM JSON output
- `bookTimeline.js`: Generates a historical timeline for a book’s era
- `authorBirthplace.js`: Resolves author birthplace coordinates for Leaflet

### AI Service (Python)
- `ai-service/main.py`: FastAPI service for semantic book search (Qdrant + embeddings) and OpenAI-powered chat replies used by the Node proxy

### Scripts
- `syncBooks.js`: Imports books from Google Books / Open Library into MongoDB and Qdrant
- `importNew.js`, `updateExisting.js`, `run.js`: Partial or full catalog sync workflows
- `updateBookIndices.js`: Updates indices used by the recommendation model

### Views
- EJS templates for all pages with responsive design
- Partial components for code reusability (`header`, `footer`, `ai_widget`, `book-thumbnail`)
- `ai-agent.js`: Client-side chat (history, fetch to `/api/ai/chat`, feedback)
- Static assets (CSS, images); book details page includes timeline, map, and enrichment UI

## Prerequisites

- Node.js (v18.0.0 or higher recommended)
- MongoDB (v4.4 or higher, or Docker)
- npm (v8.0.0 or higher)
- Git
- **Docker Desktop** (recommended for MongoDB, Qdrant, and full stack)
- **Python 3.12+** (if running `ai-service` locally outside Docker)
- **OpenAI API key** (for AI chat and embeddings; optional fallbacks: Groq, Ollama, Anthropic for enrichment)

## Installation

1. Clone the repository:
```bash
git clone https://github.com/Pallka/Book_Recommender.git
cd Book_Recommender
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the root directory:
```env
NODE_ENV=development
MONGO_URI=mongodb://localhost:27017/book-recommender
SECRET_KEY=your_secret_key_here
AI_SERVICE_URL=http://localhost:8000
INTERNAL_API_KEY=dev-shared-secret-change-me
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
ANTHROPIC_API_KEY=
OLLAMA_BASE_URL=http://127.0.0.1:11434/v1
OLLAMA_MODEL=llama3.2
```

4. Initialize the database:

**Option A — Docker (recommended):**
```bash
docker compose up --build
```
Open http://localhost:3000

**Option B — Local Node + databases:**
```bash
docker compose up -d mongo qdrant
mongosh   # optional: verify MongoDB
npm run devStarts
```
In a separate terminal, run `ai-service` (see `ai-service/requirements.txt`):
```bash
cd ai-service
python -m venv .venv
source .venv/Scripts/activate   # Windows Git Bash
pip install -r requirements.txt
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

5. Populate the catalog (first run or after empty DB):
```bash
npm run sync:books
```

6. Start the development server (if not using Docker for the app):
```bash
npm run devStarts
```

### npm Scripts

| Script                | Description                            |
|-----------------------|----------------------------------------|
| `npm run devStarts`   | Start Express with nodemon (port 3000) |
| `npm run sync:books`  | Sync books to MongoDB + Qdrant         |
| `npm run sync:import` | Import new books only                  |
| `npm run sync:update` | Update existing books                  |
| `npm run sync:all`    | Run full sync pipeline                 |

## Usage

### User Registration and Login
1. Navigate to http://localhost:3000
2. Click "Register" to create a new account
3. Log in with your credentials

### Book Recommendations
1. Browse the book catalog (`/books`)
2. Save books to your profile
3. Receive personalized recommendations based on your preferences (`/recommendations`)
4. View detailed book information (`/books/:id`)

### AI Assistant
1. Click the floating AI button (bottom-right on supported pages)
2. Ask for genres, authors, or similar books
3. On the book details page, the assistant receives context about the current book
4. Use like/dislike on responses (stored for analytics)

### Book Details — Timeline, Map, Enrichment
1. Open a book page — view description and metadata
2. **Historical timeline** — loads via `/api/books/:id/timeline`
3. **Author map** — Leaflet map via `/api/books/:id/author-birthplace`
4. **Enrich with AI** — POST `/api/books/:id/enrich` to fill missing fields (requires Anthropic or Ollama)

### Managing Your Profile
1. View saved books on your dashboard (`/home`)
2. Delete saved books from your profile
3. Navigate to recommendations when you have saved books

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
- Import initial book data (recommended):
```bash
npm run sync:books
```

3. Configure Qdrant and `ai-service` for semantic search and chat (see `docker-compose.yml`).

### Running Tests
```bash
npm test
```

### Debugging
1. Server-side debugging:
   - Use console.log statements for basic debugging
   - Check server logs in the terminal
   - Monitor MongoDB operations
   - Verify `AI_SERVICE_URL` and `INTERNAL_API_KEY` when chat fails

2. Client-side debugging:
   - Use browser developer tools
   - Check browser console for errors
   - Monitor network requests (`/api/ai/chat`, book APIs)

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

Semantic recommendations in chat combine **Qdrant vector search** (Python service) with **ML index matches** from `modelHandler.js`.

## Security Features

1. Password Security:
   - Bcrypt hashing
   - Salted passwords
   - Secure session management

2. Authentication:
   - Passport.js local strategy
   - Session-based authentication
   - Protected routes (`/home`, `/recommendations`, save/delete book)

3. Data Protection:
   - Input validation
   - XSS protection
   - CSRF protection
   - Internal APIs protected with `INTERNAL_API_KEY` / `X-Internal-Key` header

## API Endpoints

### Authentication
- POST /login
- POST /register
- DELETE /logout

### Books
- GET /books
- GET /books/:id
- POST /save-book
- DELETE /delete-book/:bookId
- GET /user-saved-books

### Recommendations
- GET /recommendations
- GET /api/recommendations (internal ML; requires `X-Internal-Key`)

### AI Chat
- POST /api/ai/chat
- POST /api/ai/feedback

### Book Context (LLM)
- GET /api/books/:id/timeline
- GET /api/books/:id/author-birthplace
- POST /api/books/:id/enrich

### Sync (admin)
- POST /api/sync-books

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
   - Floating AI chat modal with book cards in replies
   - Leaflet map on book details
   - Historical timeline section

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

# Or with Docker
docker compose up -d mongo
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

4. AI chat not responding:
- Ensure `ai-service` is running on port 8000
- Check `AI_SERVICE_URL` and `OPENAI_API_KEY`
- Run `npm run sync:books` if Qdrant collection is empty

5. Timeline / map / enrichment unavailable:
- Set `ANTHROPIC_API_KEY` or run Ollama locally
- First LLM request may take longer (cold start)

## 📈 Performance Optimization

1. Database:
   - Indexed queries
   - Efficient data structures
   - Cached responses

2. Machine Learning:
   - Batch processing
   - Memory management
   - Optimized tensor operations

3. Vector search:
   - Qdrant for semantic retrieval
   - Embedding batching in sync scripts

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit changes
4. Push to the branch
5. Open a pull request

## Author

- Kateryna Palka
