from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://urlshortener:urlshortener@postgres:5432/urlshortener"
    redis_url: str = "redis://redis:6379/0"
    base_url: str = "http://localhost"
    redis_ttl: int = 3600
    log_level: str = "INFO"

    class Config:
        env_file = ".env"


@lru_cache
def get_settings() -> Settings:
    return Settings()
