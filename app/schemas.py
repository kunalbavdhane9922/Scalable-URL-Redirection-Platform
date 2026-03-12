from datetime import datetime

from pydantic import BaseModel, HttpUrl, field_validator


class ShortenRequest(BaseModel):
    url: HttpUrl
    expires_at: datetime | None = None


class ShortenResponse(BaseModel):
    short_code: str
    short_url: str
    original_url: str

    model_config = {"from_attributes": True}


class UrlStats(BaseModel):
    short_code: str
    original_url: str
    created_at: datetime
    click_count: int

    model_config = {"from_attributes": True}
