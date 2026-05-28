"""Pydantic settings from environment; use `get_settings()`."""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "Book Recommender AI Backend"
    debug: bool = False

    mongo_uri: str = "mongodb://localhost:27017"
    mongo_db: str = "book-recommender"
    mongo_users_collection: str = "users"
    mongo_books_collection: str = "books7k"

    qdrant_host: str = "localhost"
    qdrant_port: int = 6333
    qdrant_collection: str = "books"
    qdrant_vector_size: int = 128

    openai_api_key: str = ""
    openai_chat_model: str = "gpt-4o-mini"
    openai_embed_model: str = "text-embedding-3-small"

    embedding_backend: str = "simple"  # simple: 128-d hash (see syncBooks.js); openai: match qdrant_vector_size to model

    node_app_url: str = ""
    internal_api_key: str = ""

    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    enable_llm_rerank: bool = False


@lru_cache
def get_settings() -> Settings:
    return Settings()
