"""Text → vector for Qdrant: either the 128-d hash used by `scripts/syncBooks.js` or OpenAI embeddings."""
from __future__ import annotations

import math
from typing import Sequence

from openai import AsyncOpenAI

from config import Settings, get_settings


def simple_embedding(text: str, dim: int = 128) -> list[float]:
    """Same char-hashing + L2 norm as `scripts/syncBooks.js` (must match Qdrant payload dim)."""
    out = [0.0] * dim
    if not text:
        return out
    for i, ch in enumerate(text):
        code = ord(ch)
        out[i % dim] += (code % 23) / 23.0
    norm = math.sqrt(sum(v * v for v in out)) or 1.0
    return [v / norm for v in out]


async def embed_query(text: str, settings: Settings | None = None) -> list[float]:
    """Query vector for semantic search; `embedding_backend` simple vs OpenAI (needs API key)."""
    settings = settings or get_settings()
    if settings.embedding_backend == "openai":
        if not settings.openai_api_key:
            raise ValueError("OPENAI_API_KEY required for embedding_backend=openai")
        client = AsyncOpenAI(api_key=settings.openai_api_key)
        r = await client.embeddings.create(
            model=settings.openai_embed_model,
            input=text[:8000],
        )
        vec = list(r.data[0].embedding)
        return vec
    return simple_embedding(text, dim=settings.qdrant_vector_size)


def embed_query_sync(text: str, settings: Settings | None = None) -> list[float]:
    """Sync path for LangChain tools; only supports `embedding_backend=simple` (OpenAI needs async)."""
    settings = settings or get_settings()
    if settings.embedding_backend == "openai":
        raise RuntimeError("Use async embed_query for OpenAI backend in async routes")
    return simple_embedding(text, dim=settings.qdrant_vector_size)


def format_books_for_context(hits: Sequence[dict]) -> str:
    """Numbered catalog lines for tool prompts; Ukrainian fallback line if no titles."""
    lines: list[str] = []
    for i, h in enumerate(hits[:8], 1):
        t = h.get("title") or ""
        if not t:
            continue
        a = h.get("authors") or ""
        c = h.get("categories") or ""
        extra = ", ".join(x for x in (a, c) if x)
        lines.append(f"{i}. {t}" + (f" — {extra}" if extra else ""))
    return "\n".join(lines) if lines else "(немає збігів у каталозі)"
