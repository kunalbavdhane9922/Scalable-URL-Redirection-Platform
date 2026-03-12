from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models import Url


async def create_url(db: AsyncSession, original_url: str, expires_at=None) -> Url:
    url = Url(original_url=original_url, short_code="__pending__", expires_at=expires_at)
    db.add(url)
    await db.flush()
    return url


async def set_short_code(db: AsyncSession, url_id: int, short_code: str) -> None:
    stmt = update(Url).where(Url.id == url_id).values(short_code=short_code)
    await db.execute(stmt)


async def get_url_by_code(db: AsyncSession, short_code: str) -> Url | None:
    result = await db.execute(select(Url).where(Url.short_code == short_code))
    return result.scalar_one_or_none()


async def increment_clicks(db: AsyncSession, short_code: str) -> None:
    stmt = update(Url).where(Url.short_code == short_code).values(click_count=Url.click_count + 1)
    await db.execute(stmt)
    await db.commit()
