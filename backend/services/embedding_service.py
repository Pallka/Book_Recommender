"""Embeddings: 128-d `simple_embedding` (must match Node sync) or OpenAI when configured."""
from __future__ import annotations

import math
from typing import Sequence

from openai import AsyncOpenAI

from config import Settings, get_settings


def simple_embedding(text: str, dim: int = 128) -> list[float]:
    out = [0.0] * dim
    if not text:
        return out
    for i, ch in enumerate(text):
        code = ord(ch)
        out[i % dim] += (code % 23) / 23.0
    norm = math.sqrt(sum(v * v for v in out)) or 1.0
    return [v / norm for v in out]


async def embed_query(text: str, settings: Settings | None = None) -> list[float]:
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
    settings = settings or get_settings()
    if settings.embedding_backend == "openai":
        raise RuntimeError("embed_query_sync does not support embedding_backend=openai; use embed_query")
    return simple_embedding(text, dim=settings.qdrant_vector_size)


def format_books_for_context(hits: Sequence[dict]) -> str:
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
