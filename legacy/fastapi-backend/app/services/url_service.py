import logging
from datetime import datetime, timezone

import redis.asyncio as redis
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app import crud
from app.config import get_settings
from app.schemas import ShortenResponse, UrlStats
from app.utils.base62 import encode

logger = logging.getLogger(__name__)
settings = get_settings()

CACHE_PREFIX = "url:"


class UrlService:
    def __init__(self, db: AsyncSession, redis_client: redis.Redis):
        self.db = db
        self.redis = redis_client

    async def shorten(self, original_url: str, expires_at: datetime | None = None) -> ShortenResponse:
        url_record = await crud.create_url(self.db, original_url, expires_at)
        short_code = encode(url_record.id)
        await crud.set_short_code(self.db, url_record.id, short_code)
        await self.db.commit()

        await self.redis.setex(f"{CACHE_PREFIX}{short_code}", settings.redis_ttl, original_url)
        logger.info("shortened url=%s code=%s", original_url, short_code)

        return ShortenResponse(
            short_code=short_code,
            short_url=f"{settings.base_url}/{short_code}",
            original_url=original_url,
        )

    async def resolve(self, short_code: str) -> str:
        cached = await self.redis.get(f"{CACHE_PREFIX}{short_code}")
        if cached:
            logger.debug("cache hit code=%s", short_code)
            await crud.increment_clicks(self.db, short_code)
            return cached.decode() if isinstance(cached, bytes) else cached

        url_record = await crud.get_url_by_code(self.db, short_code)
        if not url_record:
            raise HTTPException(status_code=404, detail="Short URL not found")

        if url_record.expires_at and url_record.expires_at < datetime.now(timezone.utc):
            raise HTTPException(status_code=410, detail="Short URL has expired")

        await self.redis.setex(f"{CACHE_PREFIX}{short_code}", settings.redis_ttl, url_record.original_url)
        await crud.increment_clicks(self.db, short_code)
        logger.debug("cache miss code=%s, populated cache", short_code)

        return url_record.original_url

    async def get_stats(self, short_code: str) -> UrlStats:
        url_record = await crud.get_url_by_code(self.db, short_code)
        if not url_record:
            raise HTTPException(status_code=404, detail="Short URL not found")

        return UrlStats(
            short_code=url_record.short_code,
            original_url=url_record.original_url,
            created_at=url_record.created_at,
            click_count=url_record.click_count,
        )
