"""WhatsApp messaging tool.

POSTs to an n8n webhook which forwards `{to, message}` JSON to WhatsApp.
The recipient is fixed (demo setup) — only the message text is model-generated.
"""

from __future__ import annotations

from typing import Any

import httpx
from langchain_core.tools import tool

from app.core.config import get_settings
from app.core.logging import get_logger
from app.tools.erp._util import erp_safe

log = get_logger("tools.whatsapp")


@tool
@erp_safe
async def send_whatsapp_message(message: str) -> dict[str, Any]:
    """Send a WhatsApp message via the n8n webhook bridge.

    Use this when the user asks to "remind", "message", "ping" or "notify"
    someone on WhatsApp (e.g. "Remind Aarav to submit his assignment",
    "WhatsApp the class about tomorrow's quiz"). You write the `message`
    text yourself based on what the user wants to say — keep it short,
    polite, and self-contained (the recipient won't see the chat context).
    The recipient phone number is pre-configured on the backend; you do
    not need to ask for it.
    """
    settings = get_settings()
    payload = {"to": settings.whatsapp_default_to, "message": message}

    if not settings.whatsapp_webhook_url:
        log.info("whatsapp simulated (no webhook url configured)", to=settings.whatsapp_default_to)
        return {
            "status": "ok",
            "mode": "simulated",
            "to": settings.whatsapp_default_to,
            "message": message,
        }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(settings.whatsapp_webhook_url, json=payload)
        if resp.status_code >= 400:
            log.warning(
                "whatsapp webhook returned error; falling back to simulated delivery",
                status=resp.status_code,
                body=resp.text[:200],
            )
            return {
                "status": "ok",
                "mode": "simulated_fallback",
                "to": settings.whatsapp_default_to,
                "message": message,
                "note": f"Webhook returned HTTP {resp.status_code}; recorded in demo log.",
            }
    except Exception as exc:  # noqa: BLE001
        log.warning("whatsapp webhook unreachable; using simulated delivery", error=str(exc))
        return {
            "status": "ok",
            "mode": "simulated_fallback",
            "to": settings.whatsapp_default_to,
            "message": message,
            "note": "External n8n webhook unreachable; WhatsApp message simulated for local demo.",
        }

    log.info("whatsapp sent", to=settings.whatsapp_default_to, chars=len(message))
    return {
        "status": "ok",
        "mode": "live",
        "to": settings.whatsapp_default_to,
        "message": message,
    }
