"""Motor helpers: users (`savedBooks`), books collection, optional `ai_interactions` logging."""
from __future__ import annotations

import logging
from typing import Any, Optional

from bson import ObjectId
from bson.errors import InvalidId
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from config import Settings, get_settings

log = logging.getLogger(__name__)

_client: AsyncIOMotorClient | None = None


def get_db(settings: Settings | None = None) -> AsyncIOMotorDatabase:
    global _client
    settings = settings or get_settings()
    if _client is None:
        _client = AsyncIOMotorClient(settings.mongo_uri)
    return _client[settings.mongo_db]


async def close_mongo() -> None:
    global _client
    if _client is not None:
        _client.close()
        _client = None


async def get_saved_books_for_user(user_id: str, settings: Settings | None = None) -> list[dict[str, Any]]:
    """Up to 30 books from the user's `savedBooks` ids; [] if id invalid or empty."""
    settings = settings or get_settings()
    db = get_db(settings)
    try:
        oid = ObjectId(user_id)
    except (InvalidId, TypeError):
        log.debug("Invalid user_id for Mongo: %s", user_id)
        return []

    user = await db[settings.mongo_users_collection].find_one({"_id": oid})
    if not user or not user.get("savedBooks"):
        return []

    ids = user["savedBooks"]
    cursor = db[settings.mongo_books_collection].find({"_id": {"$in": ids}}).limit(30)
    books: list[dict[str, Any]] = []
    async for doc in cursor:
        books.append(
            {
                "title": doc.get("title") or "",
                "authors": doc.get("authors") or "",
                "categories": doc.get("categories") or "",
            }
        )
    return books


def format_saved_books_text(books: list[dict[str, Any]]) -> str:
    if not books:
        return "Користувач ще не зберіг книги в профілі."
    lines = []
    for b in books[:15]:
        lines.append(f"- {b.get('title', '')} ({b.get('authors', '')}) [{b.get('categories', '')}]")
    return "Збережені книги користувача:\n" + "\n".join(lines)


async def get_book_by_id(book_id: str, settings: Settings | None = None) -> Optional[dict[str, Any]]:
    settings = settings or get_settings()
    db = get_db(settings)
    try:
        oid = ObjectId(book_id)
    except (InvalidId, TypeError):
        return None
    return await db[settings.mongo_books_collection].find_one({"_id": oid})


async def save_ai_interaction(
    user_id: Optional[str],
    query: str,
    response: str,
    meta: dict[str, Any],
    settings: Settings | None = None,
) -> None:
    """Best-effort insert into `ai_interactions`; failures are logged and ignored."""
    settings = settings or get_settings()
    db = get_db(settings)
    doc: dict[str, Any] = {
        "query": query,
        "response": response,
        "meta": meta,
    }
    if user_id:
        try:
            doc["user_id"] = ObjectId(user_id)
        except Exception:
            doc["user_id"] = None
    try:
        await db["ai_interactions"].insert_one(doc)
    except Exception as e:
        log.warning("ai_interactions insert failed: %s", e)
