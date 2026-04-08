"""POST /api/v1/books/{book_id}/generate-description — LLM blurb from Mongo book fields."""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException
from langchain_core.messages import HumanMessage

from config import get_settings
from models.schemas import GenerateDescriptionRequest, GenerateDescriptionResponse
from services.llm_service import get_chat_model
from services.mongo_service import get_book_by_id

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["books"])


def _as_str(val: object) -> str:
    if val is None or isinstance(val, bool):
        return ""
    return str(val)


@router.post(
    "/books/{book_id}/generate-description",
    response_model=GenerateDescriptionResponse,
)
async def generate_book_description(
    book_id: str,
    body: GenerateDescriptionRequest | None = None,
) -> GenerateDescriptionResponse:
    settings = get_settings()
    if not settings.openai_api_key:
        raise HTTPException(status_code=503, detail="OPENAI_API_KEY is not configured")

    book = await get_book_by_id(book_id, settings=settings)
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")

    body = body or GenerateDescriptionRequest()
    title = _as_str(book.get("title"))
    authors = _as_str(book.get("authors"))
    categories = _as_str(book.get("categories"))
    existing = _as_str(book.get("description"))

    tone_hint = {
        "neutral": "Нейтральний енциклопедичний стиль.",
        "friendly": "Теплий, звернення на «ви», без спойлерів.",
        "short": "Максимум 2 речення.",
    }.get(body.tone, "friendly")

    lang = "українською" if body.language.lower().startswith("uk") else body.language

    prompt = f"""Книга: {title}
Автор(и): {authors}
Жанри/теги: {categories}
Існуючий опис (може бути порожнім): {existing[:1200]}

Завдання ({tone_hint}):
1) Напиши привабливий опис для картки книги мовою: {lang}.
2) Окремо 1–2 речення: чому саме ця книга може зайти читачеві (без вигаданих фактів).

Формат відповіді СТРОГО такий (два блоки):
DESCRIPTION:
...текст опису...
WHY:
...текст чому почитати...
"""

    llm = get_chat_model()
    try:
        msg = await llm.ainvoke([HumanMessage(content=prompt)])
        text = (msg.content or "").strip()
    except Exception as e:
        log.exception("generate description")
        raise HTTPException(status_code=502, detail="LLM request failed") from e

    desc, why = "", ""
    if "DESCRIPTION:" in text and "WHY:" in text:
        parts = text.split("WHY:", 1)
        desc = parts[0].replace("DESCRIPTION:", "").strip()
        why = parts[1].strip()
    else:
        desc = text
        why = "Рекомендуємо ознайомитись з описом та відгуками на сторінці книги."

    return GenerateDescriptionResponse(
        book_id=book_id,
        title=title,
        generated_description=desc,
        why_read=why,
    )
