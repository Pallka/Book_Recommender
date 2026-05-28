"""Request/response models for FastAPI routes."""
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


class HistoryMessage(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str


class ChatRequest(BaseModel):
    message: str = Field(default="", description="Primary field used by the browser widget")
    user_input: str = Field(default="", description="Alias used by older Python clients")
    user_id: Optional[str] = None
    history: list[HistoryMessage] = Field(default_factory=list)

    def effective_message(self) -> str:
        t = (self.message or self.user_input or "").strip()
        return t


class BookSummary(BaseModel):
    title: str
    authors: Optional[str] = None
    categories: Optional[str] = None
    score: Optional[float] = None


class RecommendationBundle(BaseModel):
    semantic: list[BookSummary] = Field(default_factory=list)
    ml: list[BookSummary] = Field(default_factory=list)


class ChatResponse(BaseModel):
    reply: str
    explanation: Optional[str] = None
    recommendations: RecommendationBundle = Field(default_factory=RecommendationBundle)
    meta: dict[str, Any] = Field(default_factory=dict)


class GenerateDescriptionRequest(BaseModel):
    tone: Literal["neutral", "friendly", "short"] = "friendly"
    language: str = "uk"


class GenerateDescriptionResponse(BaseModel):
    book_id: str
    title: str
    generated_description: str
    why_read: str = Field(description="Short 'why read this' blurb from the LLM")
