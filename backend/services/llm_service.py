"""OpenAI chat client and optional candidate re-ranking."""
from langchain_openai import ChatOpenAI

from config import Settings, get_settings


def get_chat_model(model_name: str | None = None) -> ChatOpenAI:
    settings = get_settings()
    name = model_name or settings.openai_chat_model
    if not settings.openai_api_key:
        raise ValueError("OPENAI_API_KEY is not set")
    return ChatOpenAI(
        model=name,
        temperature=0.35,
        api_key=settings.openai_api_key,
    )


async def llm_rerank_books(
    user_query: str,
    candidates: list[dict],
    settings: Settings | None = None,
) -> list[dict]:
    settings = settings or get_settings()
    if not candidates or not settings.openai_api_key:
        return candidates
    llm = get_chat_model()
    lines = "\n".join(
        f"{i}. {c.get('title', '')} | {c.get('authors', '')} | {c.get('categories', '')}"
        for i, c in enumerate(candidates[:15])
    )
    prompt = (
        f"Запит користувача: {user_query}\n\nКандидати:\n{lines}\n\n"
        "Поверни ТІЛЬКИ список номерів через кому (наприклад: 3,1,5) — від найкращого до гіршого."
    )
    msg = await llm.ainvoke(prompt)
    text = (msg.content or "").strip()
    order: list[int] = []
    for part in text.replace(" ", "").split(","):
        if part.isdigit():
            order.append(int(part) - 1)
    seen = set()
    reranked: list[dict] = []
    for idx in order:
        if 0 <= idx < len(candidates) and idx not in seen:
            seen.add(idx)
            reranked.append(candidates[idx])
    for i, c in enumerate(candidates):
        if i not in seen:
            reranked.append(c)
    return reranked[:10]
