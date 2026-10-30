from fastapi import APIRouter, Depends, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas import ShortenRequest, ShortenResponse, UrlStats
from app.services.url_service import UrlService

router = APIRouter()


def get_service(request: Request, db: AsyncSession = Depends(get_db)) -> UrlService:
    return UrlService(db, request.app.state.redis)


@router.post("/api/shorten", response_model=ShortenResponse, status_code=201)
async def shorten_url(body: ShortenRequest, service: UrlService = Depends(get_service)):
    return await service.shorten(str(body.url), body.expires_at)


@router.get("/api/stats/{short_code}", response_model=UrlStats)
async def url_stats(short_code: str, service: UrlService = Depends(get_service)):
    return await service.get_stats(short_code)


@router.get("/{short_code}")
async def redirect(short_code: str, service: UrlService = Depends(get_service)):
    original_url = await service.resolve(short_code)
    return RedirectResponse(url=original_url, status_code=302)
