"""SlowAPI rate limiting configuration for FastAPI."""

from __future__ import annotations

from fastapi import Request
from slowapi import Limiter
from app.core.config import get_settings


def get_real_client_ip(request: Request) -> str:
    """Extract real client IP from X-Forwarded-For or socket client host."""
    xff = request.headers.get("x-forwarded-for")
    if xff:
        # In X-Forwarded-For: <client>, <proxy1>, <proxy2>
        # The leftmost IP is the original client IP
        parts = [p.strip() for p in xff.split(",") if p.strip()]
        if parts:
            return parts[0]
    if request.client and request.client.host:
        return request.client.host
    return "127.0.0.1"


settings = get_settings()
limiter = Limiter(
    key_func=get_real_client_ip,
    enabled=settings.rate_limit_enabled,
    default_limits=[],
)
