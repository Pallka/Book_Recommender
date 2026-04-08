"""LangChain `@tool` callables wired into the ReAct agent (Qdrant, Mongo, Node ML proxy, CF placeholder)."""
from __future__ import annotations

import logging
import urllib.parse
from typing import List

import httpx
from langchain_core.tools import tool

from ai_agent.context import current_user_id
from config import get_settings
from services.embedding_service import format_books_for_context
from services.mongo_service import format_saved_books_text, get_saved_books_for_user
from services.qdrant_service import semantic_search

log = logging.getLogger(__name__)


@tool
async def search_books_semantic(query: str) -> str:
    """
    Семантичний пошук книг у каталозі (Qdrant + embeddings).
    Використовуй для жанрів, настрою, схожих назв, тем.
    """
    hits = await semantic_search(query, limit=10)
    return format_books_for_context(hits)


@tool
async def get_saved_books_profile() -> str:
    """
    Збережені книги поточного користувача (якщо залогінений).
    Використовуй для персоналізованих рекомендацій.
    """
    uid = current_user_id.get()
    if not uid:
        return "Користувач анонімний — немає збережених книг у сесії."
    books = await get_saved_books_for_user(uid)
    return format_saved_books_text(books)


@tool
async def ml_similar_titles(seed_title: str) -> str:
    """
    Рекомендації на основі TF моделі (як на сайті), якщо доступний Node backend.
    Передай точну або наближену назву книги-якоря.
    """
    settings = get_settings()
    base = (settings.node_app_url or "").rstrip("/")
    if not base:
        return "ML-сервіс Node не налаштований (NODE_APP_URL)."
    q = urllib.parse.quote(seed_title.strip())
    url = f"{base}/api/recommendations?title={q}"
    headers = {}
    if settings.internal_api_key:
        headers["X-Internal-Key"] = settings.internal_api_key
    try:
        async with httpx.AsyncClient(timeout=45.0) as client:
            r = await client.get(url, headers=headers)
        if not r.is_success:
            return f"ML API помилка: {r.status_code}"
        data = r.json()
        books = data.get("books") or []
        lines = []
        for b in books[:12]:
            if isinstance(b, dict) and b.get("title"):
                lines.append(f"- {b['title']}")
        return "\n".join(lines) if lines else "Порожня відповідь ML."
    except Exception as e:
        log.warning("ml_similar_titles: %s", e)
        return f"Не вдалося викликати ML: {e}"


@tool
def collaborative_filtering_note(genre: str = "") -> str:
    """
    Collaborative filtering: потрібні масові рейтинги/взаємодії.
    Зараз даних недостатньо — поясни користувачу обмеження.
    """
    g = genre or "загалом"
    return (
        f"Колаборативні рекомендації для «{g}» потребують матриці user–item; "
        "у поточній БД немає достатньої кількості рейтингів. "
        "Використай semantic search та збережені книги користувача."
    )


def all_tools() -> List:
    return [
        search_books_semantic,
        get_saved_books_profile,
        ml_similar_titles,
        collaborative_filtering_note,
    ]
