import logging
from contextlib import asynccontextmanager

import redis.asyncio as redis
from fastapi import FastAPI

from app.config import get_settings
from app.database import Base, engine
from app.routes.url_routes import router

settings = get_settings()

logging.basicConfig(
    level=settings.log_level,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # startup
    app.state.redis = redis.from_url(settings.redis_url, decode_responses=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("database tables created, redis pool ready")

    yield

    # shutdown
    await app.state.redis.aclose()
    await engine.dispose()
    logger.info("connections closed")


app = FastAPI(
    title="URL Shortener",
    version="1.0.0",
    lifespan=lifespan,
)

app.include_router(router)
