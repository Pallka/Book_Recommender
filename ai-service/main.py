"""Small FastAPI service: Qdrant + OpenAI chat (embedding aligned with `scripts/syncBooks.js`)."""
import logging
import math
import os
import urllib.parse
from typing import Any, Optional

import httpx
from fastapi import FastAPI, HTTPException
from openai import OpenAI
from pydantic import BaseModel, Field
from qdrant_client import QdrantClient

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("ai-service")

VECTOR_DIM = 128
QDRANT_COLLECTION = os.getenv("QDRANT_COLLECTION", "books")

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_CHAT_MODEL = os.getenv("OPENAI_CHAT_MODEL", "gpt-4o-mini")
QDRANT_HOST = os.getenv("QDRANT_HOST", "localhost")
QDRANT_PORT = int(os.getenv("QDRANT_PORT", "6333"))
NODE_APP_URL = (os.getenv("NODE_APP_URL") or "").rstrip("/")
INTERNAL_API_KEY = os.getenv("INTERNAL_API_KEY", "")


def simple_embedding(text: str, dim: int = VECTOR_DIM) -> list[float]:
    out = [0.0] * dim
    if not text:
        return out
    for i, ch in enumerate(text):
        code = ord(ch)
        out[i % dim] += (code % 23) / 23.0
    norm = math.sqrt(sum(v * v for v in out)) or 1.0
    return [v / norm for v in out]


app = FastAPI(title="Book Recommender AI")


class HistoryMsg(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    user_input: str
    user_id: Optional[str] = None
    history: list[HistoryMsg] = Field(default_factory=list)


def qdrant_search(vector: list[float], limit: int = 8) -> list[dict[str, Any]]:
    """Semantic catalog lookup in Qdrant; returns title/author/category payloads."""
    client = QdrantClient(host=QDRANT_HOST, port=QDRANT_PORT, timeout=30)
    try:
        res = client.search(
            collection_name=QDRANT_COLLECTION,
            query_vector=vector,
            limit=limit,
            with_payload=True,
        )
    except Exception as e:
        log.warning("Qdrant search failed: %s", e)
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
            }
        )
    return hits


def fetch_ml_books(seed_title: str) -> list[dict[str, str]]:
    if not NODE_APP_URL or not seed_title.strip():
        return []
    q = urllib.parse.quote(seed_title.strip())
    url = f"{NODE_APP_URL}/api/recommendations?title={q}"
    headers = {}
    if INTERNAL_API_KEY:
        headers["X-Internal-Key"] = INTERNAL_API_KEY
    try:
        with httpx.Client(timeout=45.0) as client:
            r = client.get(url, headers=headers)
        if not r.is_success:
            log.warning("ML fetch %s: %s", r.status_code, r.text[:200])
            return []
        data = r.json()
        books = data.get("books") or []
        out: list[dict[str, str]] = []
        for b in books[:12]:
            if isinstance(b, dict) and b.get("title"):
                out.append({"title": str(b["title"])})
        return out
    except Exception as e:
        log.warning("ML fetch failed: %s", e)
        return []


def build_context_lines(hits: list[dict[str, Any]]) -> list[str]:
    lines: list[str] = []
    for i, h in enumerate(hits[:6], 1):
        t = h.get("title") or ""
        if not t:
            continue
        authors = h.get("authors") or ""
        cat = h.get("categories") or ""
        extra = ", ".join(x for x in (authors, cat) if x)
        lines.append(f"{i}. {t}" + (f" — {extra}" if extra else ""))
    return lines


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/chat")
def chat(body: ChatRequest) -> dict[str, Any]:
    """Embed query, search Qdrant, optional ML seed, then OpenAI chat reply."""
    message = (body.user_input or "").strip()
    if not message:
        return {"reply": "", "error": "empty message"}

    if not OPENAI_API_KEY:
        log.error("OPENAI_API_KEY is not set")
        raise HTTPException(status_code=503, detail="OPENAI_API_KEY required for ai-service")

    vec = simple_embedding(message)
    semantic_hits = qdrant_search(vec, limit=8)
    context_lines = build_context_lines(semantic_hits)

    ml_books: list[dict[str, str]] = []
    if semantic_hits:
        first_title = (semantic_hits[0].get("title") or "").strip()
        if first_title:
            ml_books = fetch_ml_books(first_title)

    system = (
        "You are a helpful assistant for a Book Recommender web app. "
        "Use the catalog context when relevant. Be concise. "
        "If context does not match the question, answer from general knowledge "
        "and suggest how the user could browse or search on the site. "
        "Use plain text only: no Markdown headings (#), no **bold**, no backticks. "
        "Separate paragraphs with a blank line; each list item on its own line starting with \"- \"."
    )

    user_content = message
    if context_lines:
        user_content = (
            "Relevant books from the catalog (semantic search):\n"
            + "\n".join(context_lines)
            + "\n\nUser message:\n"
            + message
        )

    oa = OpenAI(api_key=OPENAI_API_KEY)
    oa_messages: list[dict[str, str]] = [{"role": "system", "content": system}]
    for m in body.history[-12:]:
        if m.role in ("user", "assistant") and m.content:
            oa_messages.append({"role": m.role, "content": m.content})
    oa_messages.append({"role": "user", "content": user_content})

    completion = oa.chat.completions.create(
        model=OPENAI_CHAT_MODEL,
        messages=oa_messages,
        temperature=0.4,
    )
    reply = (completion.choices[0].message.content or "").strip()
    if not reply:
        reply = "I could not generate a reply. Please try again."

    return {
        "reply": reply,
        "explanation": None,
        "semantic_hits": [{"title": h.get("title") or ""} for h in semantic_hits if h.get("title")],
        "ml_books": ml_books,
    }
