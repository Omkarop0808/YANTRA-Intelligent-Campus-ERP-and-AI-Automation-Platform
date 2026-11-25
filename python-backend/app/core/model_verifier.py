"""Startup verification for Google Gemini models.

Queries the Gemini API models list endpoint and logs which configured models exist,
warning if any configured models are missing or deprecated.
"""

from __future__ import annotations

from typing import Any
from app.core.config import Settings
from app.core.logging import get_logger

log = get_logger("gemini.models")


def verify_gemini_models(settings: Settings) -> dict[str, Any]:
    """Startup verification: queries Gemini models list endpoint and logs which configured models exist."""
    if not settings.gemini_api_key:
        log.info("GEMINI_API_KEY unset; skipping Gemini models startup check")
        return {"checked": False, "reason": "no_api_key"}

    try:
        from google import genai

        client = genai.Client(api_key=settings.gemini_api_key)
        available_models: set[str] = set()
        for m in client.models.list():
            name = getattr(m, "name", "")
            if name:
                available_models.add(name)
                available_models.add(name.removeprefix("models/"))

        configured = settings.gemini_model_list
        existing = [
            m for m in configured if m in available_models or f"models/{m}" in available_models
        ]
        missing = [m for m in configured if m not in existing]

        log.info(
            "Gemini models startup check complete",
            configured=configured,
            existing=existing,
            missing=missing,
            available_count=len(available_models) // 2 if available_models else 0,
        )
        if missing:
            log.warning(
                "Some configured Gemini models were not found for this API key / are deprecated",
                missing=missing,
            )
        return {
            "checked": True,
            "configured": configured,
            "existing": existing,
            "missing": missing,
        }
    except Exception as e:
        log.warning("Failed to query Gemini models list endpoint during startup", error=str(e))
        return {"checked": False, "error": str(e)}
