"""Tests for reverse proxy client IP resolution and rate limit bucket isolation."""

from __future__ import annotations

from unittest.mock import MagicMock
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from slowapi.errors import RateLimitExceeded
from slowapi import _rate_limit_exceeded_handler

from app.core.rate_limit import get_real_client_ip, limiter


def test_client_ip_resolution_x_forwarded_for():
    """Verify get_real_client_ip correctly extracts leftmost client IP across proxy formats."""
    # 1. Single IP in X-Forwarded-For
    req1 = MagicMock(spec=Request)
    req1.headers = {"x-forwarded-for": "203.0.113.195"}
    req1.client = MagicMock(host="10.0.0.1")
    assert get_real_client_ip(req1) == "203.0.113.195"

    # 2. Multi-hop proxy chain: <client>, <proxy1>, <proxy2>
    req2 = MagicMock(spec=Request)
    req2.headers = {"x-forwarded-for": "203.0.113.195, 192.168.1.1, 10.0.0.1"}
    req2.client = MagicMock(host="10.0.0.1")
    assert get_real_client_ip(req2) == "203.0.113.195"

    # 3. Missing X-Forwarded-For falls back to socket client
    req3 = MagicMock(spec=Request)
    req3.headers = {}
    req3.client = MagicMock(host="198.51.100.5")
    assert get_real_client_ip(req3) == "198.51.100.5"

    # 4. No client socket falls back to 127.0.0.1
    req4 = MagicMock(spec=Request)
    req4.headers = {}
    req4.client = None
    assert get_real_client_ip(req4) == "127.0.0.1"


def test_two_different_x_forwarded_for_get_separate_rate_limit_buckets():
    """Verify requests with different X-Forwarded-For addresses are isolated in separate rate limit buckets."""
    app = FastAPI()
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

    @app.get("/rate-limit-test")
    @limiter.limit("2/minute")
    def limited_route(request: Request):
        return {"status": "ok", "client_ip": get_real_client_ip(request)}

    client = TestClient(app)

    ip_a = "198.51.100.10"
    ip_b = "203.0.113.20"

    headers_a = {"X-Forwarded-For": ip_a}
    headers_b = {"X-Forwarded-For": ip_b}

    # Exhaust limit (2 req/min) for IP A
    r1_a = client.get("/rate-limit-test", headers=headers_a)
    assert r1_a.status_code == 200
    assert r1_a.json()["client_ip"] == ip_a

    r2_a = client.get("/rate-limit-test", headers=headers_a)
    assert r2_a.status_code == 200

    r3_a = client.get("/rate-limit-test", headers=headers_a)
    assert r3_a.status_code == 429, f"Expected 429 for IP A, got {r3_a.status_code}"

    # IP B should NOT be rate limited — it has its own separate bucket!
    r1_b = client.get("/rate-limit-test", headers=headers_b)
    assert r1_b.status_code == 200, f"Expected 200 for IP B, got {r1_b.status_code}"
    assert r1_b.json()["client_ip"] == ip_b

    r2_b = client.get("/rate-limit-test", headers=headers_b)
    assert r2_b.status_code == 200

    # IP B's 3rd request reaches its own limit
    r3_b = client.get("/rate-limit-test", headers=headers_b)
    assert r3_b.status_code == 429, f"Expected 429 for IP B, got {r3_b.status_code}"

    # IP A remains rate limited
    r4_a = client.get("/rate-limit-test", headers=headers_a)
    assert r4_a.status_code == 429
