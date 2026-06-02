# 📘 Book Recommender

> Вебзастосунок для пошуку книг, збереження у профіль, персоналізованих рекомендацій (TensorFlow.js) та AI-асистента з семантичним пошуком (Qdrant + OpenAI).

**Репозиторій проєкту:** https://github.com/Pallka/Book_Recommender

---

## Автор

- **ПІБ**: Палка Катерина Олегівна
- **Група**: ФЕC-42
- **Керівник**: Парубочий Віталій Олегович
- **Дата виконання**: 28.05.2026

---

## Загальна інформація

- **Тип проєкту**: Вебзастосунок (серверний рендеринг + REST API)
- **Мова програмування**: JavaScript (Node.js), Python (FastAPI — `ai-service`)
- **Фреймворки / бібліотеки**: Express, EJS, Bootstrap, MongoDB, Mongoose, Passport.js, TensorFlow.js, Qdrant, Leaflet.js
- **AI / ML**: OpenAI (чат), Claude або Ollama (збагачення книг, timeline, карта автора), власна рекомендаційна модель на TensorFlow.js

---

## Опис функціоналу

-  Реєстрація, вхід і вихід із системи (сесії Passport.js)
-  Каталог книг: пошук, пагінація, перегляд деталей
-  Збереження та видалення книг у профілі користувача
-  Персоналізовані рекомендації на основі збережених книг (ML-модель)
-  AI-чат (плаваючий віджет): відповіді з картками книг, like/dislike
-  Карта місця народження автора (Leaflet + LLM)
-  Історичний контекст книги (timeline, LLM)
-  Збагачення метаданих книги (`Enrich with AI`)
-  Синхронізація каталогу з зовнішніх API у MongoDB та Qdrant

---

## Опис основних файлів

| Файл / каталог                 | Призначення                                                                  |
|--------------------------------|------------------------------------------------------------------------------|
| `server.js`                    | Точка входу Express: маршрути, API, проксі AI-чату                           |
| `config.js`                    | Підключення MongoDB, моделі `User`, `Book`, `SearchHistory`, `AiInteraction` |
| `passport-config.js`           | Локальна стратегія авторизації (email + пароль)                              |
| `model/modelHandler.js`        | Рекомендаційна модель TensorFlow.js, профіль користувача                     |
| `services/llm.js`              | Виклики LLM (Claude / Ollama) для JSON-відповідей                            |
| `services/bookEnrichment.js`   | Доповнення полів книги через LLM                                             |
| `services/bookTimeline.js`     | Генерація історичного timeline                                               |
| `services/authorBirthplace.js` | Місце народження автора для карти                                            |
| `views/`                       | EJS-шаблони сторінок і partials (`header`, `footer`, `ai_widget`)            |
| `views/js/ai-agent.js`         | Клієнтський чат: localStorage, fetch, feedback                               |
| `scripts/syncBooks.js`         | Імпорт книг → Mongo + вектори в Qdrant                                       |
| `ai-service/main.py`           | FastAPI: семантичний пошук + OpenAI-чат                                      |
| `backend/`                     | Опційний LangGraph ReAct API (окремий деплой)                                |
| `docker-compose.yml`           | Mongo, Qdrant, `ai-service`, Node `app`                                      |

---

## ▶Як запустити проєкт

### 1. Встановлення інструментів

- Node.js v18+ та npm v8+
- Docker Desktop (рекомендовано для MongoDB і Qdrant)
- Python 3.12+ (якщо запуск `ai-service` окремо на хості)
- Git

### 2. Клонування репозиторію

```bash
git clone https://github.com/Pallka/Book_Recommender.git
cd Book_Recommender
```

### 3. Встановлення залежностей

```bash
npm install
```

### 4. Створення файлу `.env` у корені проєкту

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

Для `ai-service` (локально або в Docker) також потрібні `QDRANT_HOST`, `NODE_APP_URL`, `INTERNAL_API_KEY`

### 5. Запуск

**Варіант A — повний стек у Docker (найпростіше):**

```bash
docker compose up --build
```

Відкрийте http://localhost:3000

**Варіант B — розробка на хості:**

```bash
# Бази даних
docker compose up -d mongo qdrant

# Node.js
npm run devStarts

# AI-сервіс (окремий термінал)
cd ai-service
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --host 127.0.0.1 --port 8000

# Заповнення каталогу (за потреби)
npm run sync:books
```

### npm-скрипти

| Скрипт                | Опис                                |
|-----------------------|-------------------------------------|
| `npm run devStarts`   | Express з nodemon (порт 3000)       |
| `npm run sync:books`  | Синхронізація книг → Mongo + Qdrant |
| `npm run sync:import` | `scripts/importNew.js`              |
| `npm run sync:update` | `scripts/updateExisting.js`         |
| `npm run sync:all`    | `scripts/run.js`                    |

---

## API приклади

### Авторизація

**POST /login** — форма (`email`, `password`), сесія в cookie.

**POST /register** — `name`, `email`, `password`, `confirmPassword`.

**DELETE /logout** — вихід із системи.

---

### Книги

**GET /books** — каталог (query: `search`, `page`, `yearFrom`, `yearTo`).

**GET /books/:id** — сторінка деталей книги.

**POST /save-book** (потрібен вхід)

```json
{
  "bookId": "507f1f77bcf86cd799439011"
}
```

**DELETE /delete-book/:bookId** (потрібен вхід)

---

### AI-чат

**POST /api/ai/chat**

```json
{
  "message": "Recommend fantasy books",
  "history": [],
  "current_book": {
    "_id": "507f1f77bcf86cd799439011",
    "title": "Pride and Prejudice",
    "authors": "Jane Austen",
    "url": "/books/507f1f77bcf86cd799439011"
  }
}
```

**Response (фрагмент):**

```json
{
  "reply": "...",
  "books": [{ "_id": "...", "title": "...", "thumbnail": "..." }],
  "interactionId": "..."
}
```

**POST /api/ai/feedback**

```json
{
  "interactionId": "...",
  "rating": "like"
}
```

---

### Збагачення та контекст книги

| Метод | Шлях                               | Опис                       |
|-------|------------------------------------|----------------------------|
| GET   | `/api/books/:id/timeline`          | Історичний контекст        |
| GET   | `/api/books/:id/author-birthplace` | Координати для карти       |
| POST  | `/api/books/:id/enrich`            | Доповнення полів через LLM |

**GET /api/recommendations?title=Harry%20Potter`** — внутрішній ML-міст (заголовок `X-Internal-Key`).

---

## Інструкція для користувача

1. **Головна сторінка** (`/`) — опис сервісу, кнопки **Log in** / **Sign-up**.

2. **Реєстрація та вхід** — створіть обліковий запис, увійдіть на `/home`.

3. **Каталог** (`/books`) — пошук книги, перегляд карток, **Save Book**, **Show more**.

4. **Профіль** (`/home`) — збережені книги, **Delete**, перехід до деталей.

5. **Рекомендації** (`/recommendations`) — персоналізований список після збереження книг.

6. **Сторінка книги** — опис, timeline, карта автора, **Enrich with AI**, **Save Book**.

7. **AI-чат** — кнопка внизу справа; можна питати про жанри або про поточну книгу на сторінці деталей.

8. **Вихід** — **Log out** у меню.

---

## Приклади / скриншоти

Зображення містяться у папці `/screenshots/`)
- Головна сторінка
- Каталог книг
- Профіль (збережені книги)
- Рекомендації
- Сторінка книги + AI-чат


---

## Проблеми і рішення

| Проблема | Рішення |
|-----------|----------|
| MongoDB не підключається | Виконайте `docker compose up -d mongo`. Для запуску Node.js на хості використовуйте `MONGO_URI=mongodb://localhost:27017/book-recommender`. |
| AI-чат не відповідає | Перевірте роботу сервісу `ai-service` на порту `8000`, а також коректність змінних `AI_SERVICE_URL` та `OPENAI_API_KEY`. |
| Порожня колекція Qdrant | Виконайте `npm run sync:books`. |
| Timeline або карта не завантажуються | Необхідно налаштувати `ANTHROPIC_API_KEY` або Ollama. Перший запит може виконуватися довше через генерацію та кешування даних. |
| Захищені сторінки перенаправляють на Login | Увійдіть до системи. Сторінки `/home` та `/recommendations` доступні лише для автентифікованих користувачів. |
| Помилки залежностей Node.js | Виконайте `npm cache clean --force`, видаліть каталог `node_modules` та запустіть `npm install`. |

---

## Releases

Версія `v1.0` доступна за посиланням: 
https://github.com/Pallka/Book_Recommender/releases/tag/v1.0

---

## Використані джерела / література

- [Express.js](https://expressjs.com/)
- [MongoDB](https://www.mongodb.com/docs/) та [Mongoose](https://mongoosejs.com/)
- [TensorFlow.js](https://www.tensorflow.org/js)
- [Qdrant](https://qdrant.tech/documentation/)
- [OpenAI API](https://platform.openai.com/docs)
- [Bootstrap 5](https://getbootstrap.com/docs/5.3/getting-started/introduction/)
- [Leaflet](https://leafletjs.com/)
- [Passport.js](http://www.passportjs.org/)


