"""Per-request `user_id` for tools via ContextVar (no module-level globals)."""
import contextvars

current_user_id: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "current_user_id", default=None
)


def set_user_id(user_id: str | None) -> contextvars.Token:
    return current_user_id.set(user_id)


def reset_user_id(token: contextvars.Token) -> None:
    current_user_id.reset(token)
