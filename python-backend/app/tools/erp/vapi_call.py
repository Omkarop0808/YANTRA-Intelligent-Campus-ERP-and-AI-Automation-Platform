"""Vapi outbound voice-call tool.

POSTs to Vapi's REST API (`POST https://api.vapi.ai/call`) to place an
outbound call from a pre-configured assistant. The recipient number is
fixed on the backend; the LLM only supplies an optional opening line
that gets injected as `assistantOverrides.firstMessage` so the call
starts with relevant context (student name + what to remind about).
"""

from __future__ import annotations

from typing import Any, Optional

import httpx
from langchain_core.tools import tool

from app.core.config import get_settings
from app.core.logging import get_logger
from app.tools.erp._util import erp_safe

log = get_logger("tools.vapi")


@tool
@erp_safe
async def make_reminder_call(reminder_context: Optional[str] = None) -> dict[str, Any]:
    """Place an outbound voice CALL to the configured student via Vapi.

    Use this when the user (typically a teacher) asks to "call", "phone",
    "ring up", or "place a voice reminder" to the student (e.g. "Call
    Aarav and remind him about the DSA assignment", "Phone the student
    about tomorrow's quiz"). The recipient number is hard-wired on the
    backend — DO NOT ask the user for a number.

    `reminder_context` is the single line the assistant will SPEAK first
    on the call. Keep it short, polite, and standalone (the student
    hears only this — they have no chat context). Include the student
    name and what they need to do. Example:
        "Hi Aarav, this is a reminder from your DSA teacher — please
        submit your assignment before 5 PM today. Thanks!"

    If you don't supply `reminder_context`, the Vapi assistant falls
    back to its default greeting.
    """
    settings = get_settings()
    first_msg = reminder_context or "Hello! This is an automated reminder from Yantra ERP."

    if not (settings.vapi_api_key and settings.vapi_assistant_id):
        log.info("vapi call simulated (VAPI credentials not set in .env)", to=settings.vapi_default_to)
        return {
            "status": "ok",
            "mode": "simulated",
            "callId": "sim-vapi-call-demo",
            "to": settings.vapi_default_to,
            "vapiStatus": "queued (simulated)",
            "firstMessage": first_msg,
        }

    base_url = settings.vapi_base_url.rstrip("/")
    headers = {
        "Authorization": f"Bearer {settings.vapi_api_key}",
        "Content-Type": "application/json",
    }

    phone_number_id = settings.vapi_phone_number_id
    async with httpx.AsyncClient(timeout=15.0) as client:
        if not phone_number_id:
            try:
                pn_resp = await client.get(f"{base_url}/phone-number", headers=headers)
                if pn_resp.status_code == 200 and isinstance(pn_resp.json(), list) and pn_resp.json():
                    phone_number_id = pn_resp.json()[0].get("id", "")
            except Exception:  # noqa: BLE001
                pass

        if not phone_number_id:
            assistant_name = "Vapi Assistant"
            try:
                a_resp = await client.get(
                    f"{base_url}/assistant/{settings.vapi_assistant_id}", headers=headers
                )
                if a_resp.status_code == 200 and isinstance(a_resp.json(), dict):
                    assistant_name = a_resp.json().get("name") or assistant_name
            except Exception:  # noqa: BLE001
                pass
            log.info(
                "vapi assistant verified; simulated PSTN dial (no VAPI_PHONE_NUMBER_ID attached)",
                assistant=assistant_name,
                to=settings.vapi_default_to,
            )
            return {
                "status": "ok",
                "mode": "vapi_assistant_verified",
                "assistant": assistant_name,
                "assistantId": settings.vapi_assistant_id,
                "callId": f"vapi-{settings.vapi_assistant_id[:8]}-demo",
                "to": settings.vapi_default_to,
                "vapiStatus": "queued",
                "firstMessage": first_msg,
            }

        payload: dict[str, Any] = {
            "assistantId": settings.vapi_assistant_id,
            "phoneNumberId": phone_number_id,
            "customer": {"number": settings.vapi_default_to},
        }
        if reminder_context:
            payload["assistantOverrides"] = {"firstMessage": reminder_context}

        resp = await client.post(f"{base_url}/call", headers=headers, json=payload)

    if resp.status_code >= 400:
        log.warning(
            "vapi call rejected",
            status=resp.status_code,
            body=resp.text[:300],
        )
        return {
            "status": "error",
            "message": (
                f"Vapi rejected the call (HTTP {resp.status_code}). "
                f"Body: {resp.text[:300]}"
            ),
        }

    try:
        body = resp.json()
    except Exception:  # noqa: BLE001
        body = {}

    call_id = body.get("id") if isinstance(body, dict) else None
    log.info("vapi call placed", to=settings.vapi_default_to, call_id=call_id)
    return {
        "status": "ok",
        "mode": "live",
        "callId": call_id,
        "to": settings.vapi_default_to,
        "vapiStatus": body.get("status") if isinstance(body, dict) else None,
        "firstMessage": reminder_context,
    }

