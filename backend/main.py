"""FastAPI app: `cd backend`, `pip install -r requirements.txt`, `set PYTHONPATH=.`, `uvicorn main:app --reload --port 8080`."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import get_settings
from routes import books as books_routes
from routes import chat as chat_routes
from services.mongo_service import close_mongo
from services.qdrant_service import close_qdrant, ensure_collection_exists

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
log = logging.getLogger("book-ai")


@asynccontextmanager
async def lifespan(app: FastAPI):
    s = get_settings()
    log.info("Starting %s", s.app_name)
    err = await ensure_collection_exists(s)
    if err:
        log.warning("Qdrant collection check: %s", err)
    yield
    await close_mongo()
    await close_qdrant()
    log.info("Shutdown complete")


settings = get_settings()
app = FastAPI(title=settings.app_name, lifespan=lifespan)

_origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins if _origins else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(chat_routes.router)
app.include_router(books_routes.router)


@app.get("/health")
async def health():
    qerr = await ensure_collection_exists()
    return {
        "status": "ok" if not qerr else "degraded",
        "qdrant": "ok" if not qerr else qerr,
        "mongo_configured": bool(settings.mongo_uri),
    }
