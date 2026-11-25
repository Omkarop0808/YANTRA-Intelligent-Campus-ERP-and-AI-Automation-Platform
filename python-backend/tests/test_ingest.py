"""Offline unit tests for /python-app/ingest/document and timezone normalization.

All Gemini calls are mocked — zero external network or quota usage.
"""

from __future__ import annotations

import json
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from zoneinfo import ZoneInfo

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.ingest import MAX_UPLOAD_BYTES, normalize_deadline_to_utc, router as ingest_router
from app.core.security import require_active


@pytest.fixture()
def client():
    app = FastAPI()
    app.include_router(ingest_router, prefix="/python-app")
    app.dependency_overrides[require_active] = lambda: SimpleNamespace(
        sub="6b0527016bce4d86d40677b2",
        role="student",
        raw_token="test-token",
    )
    with TestClient(app) as tc:
        yield tc
    app.dependency_overrides.clear()


def _mock_settings(**overrides):
    base = {
        "gemini_api_key": "mock-key-not-used-externally",
        "gemini_model": "gemini-test-mock",
        "institution_timezone": "Asia/Kolkata",
    }
    base.update(overrides)
    return SimpleNamespace(**base)


def test_unsupported_file_type_returns_415(client: TestClient):
    res = client.post(
        "/python-app/ingest/document",
        files={"file": ("malware.exe", b"MZ\x90\x00", "application/octet-stream")},
    )
    assert res.status_code == 415
    assert "Unsupported file type" in res.json()["detail"]


def test_file_over_10mb_returns_413(client: TestClient):
    oversized = b"\x89PNG\r\n\x1a\n" + b"0" * (MAX_UPLOAD_BYTES + 1)
    res = client.post(
        "/python-app/ingest/document",
        files={"file": ("huge_notice.png", oversized, "image/png")},
    )
    assert res.status_code == 413
    assert "too large" in res.json()["detail"].lower()


def test_gemini_429_returns_sanitized_429_without_provider_details(client: TestClient):
    fake_client = MagicMock()
    fake_client.models.generate_content.side_effect = RuntimeError(
        "429 RESOURCE_EXHAUSTED: google.genai quota exceeded for AIzaSyFAKEKEY123456"
    )

    with (
        patch("app.api.ingest.get_settings", return_value=_mock_settings()),
        patch("google.genai.Client", return_value=fake_client),
    ):
        res = client.post(
            "/python-app/ingest/document",
            files={"file": ("notice.png", b"\x89PNG\r\n\x1a\nfake", "image/png")},
        )

    assert res.status_code == 429
    detail = res.json()["detail"]
    assert detail == "The AI service is busy, try again in a moment."
    assert "RESOURCE_EXHAUSTED" not in detail
    assert "AIzaSy" not in detail
    assert "google" not in detail.lower()


def test_valid_image_returns_expected_draft_shape_and_preserves_local_time(client: TestClient):
    """15 Dec 23:59 naive local time in Asia/Kolkata is stored as 18:29 UTC and displays back as 15 Dec 23:59 IST."""
    mock_payload = {
        "subject": "CS-301 Data Structures & Algorithms",
        "title": "Binary Search Tree Lab Assignment Submission",
        "type": "assignment",
        "deadline": "2026-12-15T23:59:00",
        "confidence": 0.96,
        "low_confidence_fields": [],
    }
    fake_resp = SimpleNamespace(text=json.dumps(mock_payload))
    fake_client = MagicMock()
    fake_client.models.generate_content.return_value = fake_resp

    with (
        patch("app.api.ingest.get_settings", return_value=_mock_settings(institution_timezone="Asia/Kolkata")),
        patch("google.genai.Client", return_value=fake_client),
    ):
        res = client.post(
            "/python-app/ingest/document",
            files={"file": ("sample-notice.png", b"\x89PNG\r\n\x1a\nfake", "image/png")},
        )

    assert res.status_code == 200
    body = res.json()
    assert body["subject"] == "CS-301 Data Structures & Algorithms"
    assert body["title"] == "Binary Search Tree Lab Assignment Submission"
    assert body["type"] == "assignment"
    assert body["confidence"] == 0.96
    assert body["low_confidence_fields"] == []
    assert body["source_filename"] == "sample-notice.png"

    # Stored in UTC as 2026-12-15T18:29:00Z (NOT 2026-12-15T23:59:00Z!)
    assert body["deadline"] == "2026-12-15T18:29:00Z"

    # Converting stored UTC back to Asia/Kolkata yields 15 Dec 23:59 (NOT 16 Dec 05:29)
    stored_utc = datetime.fromisoformat(body["deadline"].replace("Z", "+00:00"))
    displayed_ist = stored_utc.astimezone(ZoneInfo("Asia/Kolkata"))
    assert (displayed_ist.year, displayed_ist.month, displayed_ist.day, displayed_ist.hour, displayed_ist.minute) == (
        2026,
        12,
        15,
        23,
        59,
    )


def test_normalize_deadline_respects_explicit_timezone():
    # Explicit UTC preserved
    assert normalize_deadline_to_utc("2026-12-15T23:59:00Z", "Asia/Kolkata") == "2026-12-15T23:59:00Z"
    # Explicit US Eastern (-05:00) converted accurately to UTC
    assert normalize_deadline_to_utc("2026-12-15T23:59:00-05:00", "Asia/Kolkata") == "2026-12-16T04:59:00Z"
    # Explicit IST (+05:30) converted accurately to UTC
    assert normalize_deadline_to_utc("2026-12-15T23:59:00+05:30", "Asia/Kolkata") == "2026-12-15T18:29:00Z"
    # Date-only defaults to 23:59 institution-local time
    assert normalize_deadline_to_utc("2026-12-15", "Asia/Kolkata") == "2026-12-15T18:29:00Z"
