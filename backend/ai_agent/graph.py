"""LangGraph ReAct agent and `run_agent` entrypoint."""
from __future__ import annotations

import logging
from typing import Any, Sequence

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage
from langgraph.prebuilt import create_react_agent

from ai_agent.context import current_user_id
from ai_agent.tools import all_tools
from config import Settings, get_settings
from services.llm_service import get_chat_model

log = logging.getLogger(__name__)

SYSTEM_PROMPT = """Ти — AI-бібліотекар у сервісі рекомендацій книг.

Правила:
- Відповідай українською, якщо користувач пише українською; інакше мовою користувача.
- Спочатку з'ясуй наміри. Якщо запит розмитий — постав одне коротке уточнення.
- Для підбору книг ВИКОРИСТОВУЙ інструменти: search_books_semantic, get_saved_books_profile, ml_similar_titles.
- Пояснюй «чому ця книга» у 1–2 реченнях для топ-рекомендацій.
- Якщо питають про колаборативні фільтри — виклич collaborative_filtering_note.
- Не вигадуй назви: опирайся на результати інструментів. Якщо каталог порожній — чесно скажи.
- Структуруй відповідь: короткий вступ, список 3–7 книг з автором/жанром, за потреби порада «що зробити далі» на сайті.
"""


def _history_to_messages(
    history: Sequence[Any],
    user_message: str,
) -> list[BaseMessage]:
    msgs: list[BaseMessage] = []
    for h in history[-16:]:
        role = getattr(h, "role", None) or (h.get("role") if isinstance(h, dict) else None)
        content = getattr(h, "content", None) or (h.get("content") if isinstance(h, dict) else "")
        if not content:
            continue
        if role == "user":
            msgs.append(HumanMessage(content=str(content)))
        elif role == "assistant":
            msgs.append(AIMessage(content=str(content)))
    msgs.append(HumanMessage(content=user_message))
    return msgs


def _compile_agent(settings: Settings):
    llm = get_chat_model(settings.openai_chat_model)
    tools = all_tools()
    return create_react_agent(llm, tools, prompt=SYSTEM_PROMPT)


_agent = None


def get_compiled_agent(settings: Settings | None = None):
    global _agent
    settings = settings or get_settings()
    if _agent is None:
        _agent = _compile_agent(settings)
    return _agent


async def run_agent(
    user_message: str,
    history: Sequence[Any],
    user_id: str | None,
    settings: Settings | None = None,
) -> str:
    """Invokes the LangGraph ReAct agent; returns the final assistant text."""
    settings = settings or get_settings()
    if not settings.openai_api_key:
        raise ValueError("OPENAI_API_KEY is required")

    token = current_user_id.set(user_id)
    try:
        agent = get_compiled_agent(settings)
        messages = _history_to_messages(history, user_message)
        result = await agent.ainvoke({"messages": messages})
        out_msgs = result.get("messages") or []
        if not out_msgs:
            return "Порожня відповідь агента."
        last = out_msgs[-1]
        if isinstance(last, AIMessage):
            c = last.content
            if isinstance(c, list):
                parts: list[str] = []
                for block in c:
                    if isinstance(block, dict) and block.get("type") == "text":
                        parts.append(str(block.get("text", "")))
                    elif hasattr(block, "text"):
                        parts.append(str(getattr(block, "text", "")))
                    else:
                        parts.append(str(block))
                text = "".join(parts).strip()
            else:
                text = (str(c) if c is not None else "").strip()
            return text or "…"
        return str(last)
    except Exception as e:
        log.exception("run_agent failed: %s", e)
        raise
    finally:
        current_user_id.reset(token)
