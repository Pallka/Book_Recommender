"""POST /api/ai/chat and /api/v1/chat: LangGraph agent + Qdrant hits for `recommendations` (same shape the Node widget expects)."""
from __future__ import annotations

import logging
import urllib.parse
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException

from ai_agent.graph import run_agent
from config import get_settings
from models.schemas import BookSummary, ChatRequest, ChatResponse, RecommendationBundle
from services.llm_service import llm_rerank_books
from services.mongo_service import save_ai_interaction
from services.qdrant_service import semantic_search

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["chat"])


async def _fetch_ml_titles(seed_title: str, settings) -> list[BookSummary]:
    """Calls Node `GET /api/recommendations?title=...` when `NODE_APP_URL` is set; empty list on failure."""
    base = (settings.node_app_url or "").rstrip("/")
    if not base or not seed_title.strip():
        return []
    q = urllib.parse.quote(seed_title.strip())
    url = f"{base}/api/recommendations?title={q}"
    headers = {}
    if settings.internal_api_key:
        headers["X-Internal-Key"] = settings.internal_api_key
    try:
        async with httpx.AsyncClient(timeout=45.0) as client:
            r = await client.get(url, headers=headers)
        if not r.is_success:
            return []
        data = r.json()
        out: list[BookSummary] = []
        for b in (data.get("books") or [])[:10]:
            if isinstance(b, dict) and b.get("title"):
                out.append(BookSummary(title=str(b["title"])))
        return out
    except Exception as e:
        log.debug("ML fetch skip: %s", e)
        return []


@router.post("/ai/chat", response_model=ChatResponse)
@router.post("/v1/chat", response_model=ChatResponse)
async def chat_endpoint(body: ChatRequest) -> ChatResponse:
    settings = get_settings()
    message = body.effective_message()
    if not message:
        raise HTTPException(status_code=400, detail="message or user_input is required")

    if not settings.openai_api_key:
        raise HTTPException(status_code=503, detail="OPENAI_API_KEY is not configured")

    try:
        raw_hits = await semantic_search(message, limit=12, settings=settings)
    except Exception as e:
        log.warning("semantic_search: %s", e)
        raw_hits = []

    ranked = raw_hits
    if settings.enable_llm_rerank and raw_hits:
        try:
            ranked = await llm_rerank_books(message, raw_hits, settings=settings)
        except Exception as e:
            log.warning("llm_rerank_books: %s", e)
            ranked = raw_hits

    semantic_summaries = [
        BookSummary(
            title=h.get("title") or "",
            authors=h.get("authors"),
            categories=h.get("categories"),
            score=h.get("score"),
        )
        for h in ranked[:8]
        if h.get("title")
    ]

    ml_summaries: list[BookSummary] = []
    if ranked and (ranked[0].get("title") or ""):
        ml_summaries = await _fetch_ml_titles(ranked[0]["title"], settings)

    try:
        reply_text = await run_agent(
            message,
            body.history,
            body.user_id,
            settings=settings,
        )
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:
        log.exception("run_agent")
        raise HTTPException(status_code=500, detail="Agent execution failed") from e

    meta: dict[str, Any] = {
        "agent": "langgraph_react",
        "qdrant_collection": settings.qdrant_collection,
        "embedding_backend": settings.embedding_backend,
    }

    try:
        await save_ai_interaction(
            body.user_id,
            message,
            reply_text,
            meta={**meta, "semantic_count": len(semantic_summaries), "ml_count": len(ml_summaries)},
            settings=settings,
        )
    except Exception:
        pass

    return ChatResponse(
        reply=reply_text,
        explanation=None,
        recommendations=RecommendationBundle(semantic=semantic_summaries, ml=ml_summaries),
        meta=meta,
    )
