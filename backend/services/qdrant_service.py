"""Async Qdrant client singleton + `semantic_search` over the books collection."""
from __future__ import annotations

import logging
from typing import Any, Optional

from qdrant_client import AsyncQdrantClient

from config import Settings, get_settings
from services.embedding_service import embed_query

log = logging.getLogger(__name__)

_qclient: AsyncQdrantClient | None = None


def get_qdrant(settings: Settings | None = None) -> AsyncQdrantClient:
    global _qclient
    settings = settings or get_settings()
    if _qclient is None:
        _qclient = AsyncQdrantClient(
            host=settings.qdrant_host,
            port=settings.qdrant_port,
            timeout=60,
        )
    return _qclient


async def close_qdrant() -> None:
    global _qclient
    if _qclient is not None:
        await _qclient.close()
        _qclient = None


async def semantic_search(
    query_text: str,
    limit: int = 10,
    settings: Settings | None = None,
) -> list[dict[str, Any]]:
    settings = settings or get_settings()
    client = get_qdrant(settings)
    vector = await embed_query(query_text, settings)
    try:
        res = await client.search(
            collection_name=settings.qdrant_collection,
            query_vector=vector,
            limit=limit,
            with_payload=True,
        )
    except Exception as e:
        log.warning("Qdrant search error: %s", e)
        return []

    hits: list[dict[str, Any]] = []
    for p in res:
        pl = p.payload or {}
        hits.append(
            {
                "title": pl.get("title") or "",
                "authors": pl.get("authors"),
                "categories": pl.get("categories"),
                "score": float(p.score) if p.score is not None else None,
                "olid": pl.get("olid"),
            }
        )
    return hits


async def ensure_collection_exists(settings: Settings | None = None) -> Optional[str]:
    """None if the configured collection exists; otherwise the exception string (for /health)."""
    settings = settings or get_settings()
    client = get_qdrant(settings)
    try:
        await client.get_collection(settings.qdrant_collection)
        return None
    except Exception as e:
        return str(e)
