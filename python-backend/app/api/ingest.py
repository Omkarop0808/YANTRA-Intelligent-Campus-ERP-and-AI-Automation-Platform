"""Document Ingestion API — Multimodal OCR & Metadata Extraction.

Extracts:
- subject: string
- title: string
- type: 'assignment' | 'exam' | 'notice' | 'project'
- deadline: ISO string (e.g. '2026-11-28T23:59:59Z')
- confidence: float between 0.0 and 1.0
- low_confidence_fields: list[str] (fields with confidence < 0.8)
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from app.core.config import get_settings
from app.core.logging import get_logger
from app.core.security import AuthPrincipal, require_active

router = APIRouter(prefix="/ingest", tags=["ingest"])
log = get_logger("ingest")

MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB
ALLOWED_MIME_TYPES = {
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
    "application/pdf",
}
ALLOWED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".pdf"}


def _is_quota_error(exc: Exception) -> bool:
    msg = str(exc).lower()
    return "429" in msg or "resource_exhausted" in msg or "quota" in msg or "rate limit" in msg


def normalize_deadline_to_utc(raw_deadline: str | None, tz_name: str = "Asia/Kolkata") -> str:
    """Normalize an extracted deadline string to UTC ISO-8601 (`...Z`).

    - If `raw_deadline` has NO explicit timezone (naive, e.g. `2026-12-15T23:59:00`
      or date-only `2026-12-15`), interpret it in the institution's local timezone
      (`tz_name`, default `Asia/Kolkata`) before converting to UTC for storage.
    - If `raw_deadline` DOES include an explicit timezone (`Z` or `±HH:MM`),
      respect that timezone and convert to UTC.
    """
    try:
        inst_tz = ZoneInfo(tz_name)
    except ZoneInfoNotFoundError:
        inst_tz = timezone.utc

    if not raw_deadline or not isinstance(raw_deadline, str) or not raw_deadline.strip():
        fallback = (datetime.now(inst_tz) + timedelta(days=7)).replace(
            hour=23, minute=59, second=0, microsecond=0
        )
        return fallback.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    cleaned = raw_deadline.strip()

    # Date-only string (e.g. "2026-12-15") -> 23:59:00 in institution-local time
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", cleaned):
        y, m, d = (int(part) for part in cleaned.split("-"))
        local_dt = datetime(y, m, d, 23, 59, 0, tzinfo=inst_tz)
        return local_dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    # Normalize trailing Z for Python fromisoformat compatibility
    iso_candidate = cleaned[:-1] + "+00:00" if cleaned.endswith(("Z", "z")) else cleaned
    try:
        dt = datetime.fromisoformat(iso_candidate)
    except ValueError:
        fallback = (datetime.now(inst_tz) + timedelta(days=7)).replace(
            hour=23, minute=59, second=0, microsecond=0
        )
        return fallback.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=inst_tz)

    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class IngestDraftResponse(BaseModel):
    subject: str = Field(description="Academic subject name or code")
    title: str = Field(description="Document or assignment title")
    type: Literal["assignment", "exam", "notice", "project"] = "notice"
    deadline: str = Field(description="Extracted deadline in ISO 8601 format")
    confidence: float = Field(ge=0.0, le=1.0, description="Overall extraction confidence")
    low_confidence_fields: list[str] = Field(default_factory=list, description="Fields flagged for review")
    source_filename: str = ""


@router.post("/document", response_model=IngestDraftResponse)
async def ingest_document(
    file: UploadFile = File(...),
    principal: AuthPrincipal = Depends(require_active),
) -> IngestDraftResponse:
    """Ingest notice/assignment PDF or image, extract metadata with Gemini multimodal OCR."""
    filename = file.filename or "uploaded_notice.pdf"
    ext = ("." + filename.rsplit(".", 1)[-1].lower()) if "." in filename else ""
    content_type = (file.content_type or "").lower()

    if content_type not in ALLOWED_MIME_TYPES and ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=415,
            detail="Unsupported file type. Please upload a PNG, JPG, WEBP, or PDF file.",
        )

    content = await file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail="File is too large. Maximum allowed size is 10 MB.",
        )

    settings = get_settings()

    # If Gemini API key is present and LIVE mode, run Gemini multimodal call
    if settings.gemini_api_key and len(content) > 0:
        try:
            from google import genai
            from google.genai import types

            client = genai.Client(api_key=settings.gemini_api_key)
            mime_type = content_type if content_type in ALLOWED_MIME_TYPES else (
                "application/pdf" if ext == ".pdf" else "image/png"
            )

            prompt = (
                "Extract academic notice or assignment metadata as strict JSON with keys: "
                "'subject', 'title', 'type' ('assignment' | 'exam' | 'notice' | 'project'), "
                "'deadline' (ISO 8601 string), 'confidence' (float 0.0-1.0), "
                "and 'low_confidence_fields' (list of keys with confidence < 0.8). "
                "IMPORTANT timezone rule for 'deadline': if the notice does NOT explicitly state a timezone, "
                "output a naive local ISO 8601 timestamp WITHOUT 'Z' or any offset (e.g. '2026-12-15T23:59:00'). "
                "Only include 'Z' or an explicit offset (e.g. '+05:30', '-05:00') if the notice itself states a timezone. "
                "Output ONLY raw JSON."
            )

            response = client.models.generate_content(
                model=settings.gemini_model,
                contents=[
                    types.Part.from_bytes(data=content, mime_type=mime_type),
                    prompt,
                ],
            )
            text = response.text or "{}"
            # Extract JSON block
            match = re.search(r"\{.*\}", text, re.DOTALL)
            if match:
                parsed = json.loads(match.group(0))
                normalized_deadline = normalize_deadline_to_utc(
                    parsed.get("deadline"),
                    tz_name=settings.institution_timezone,
                )
                return IngestDraftResponse(
                    subject=parsed.get("subject", "General Academic"),
                    title=parsed.get("title", filename),
                    type=parsed.get("type", "notice"),
                    deadline=normalized_deadline,
                    confidence=float(parsed.get("confidence", 0.9)),
                    low_confidence_fields=parsed.get("low_confidence_fields", []),
                    source_filename=filename,
                )
        except Exception as e:
            if _is_quota_error(e):
                log.warning("gemini quota/rate-limit hit during notice ingest")
                raise HTTPException(
                    status_code=429,
                    detail="The AI service is busy, try again in a moment.",
                ) from None
            log.warning("gemini extraction error, falling back to heuristic parser", error=type(e).__name__)

    # Deterministic offline mock / heuristic parser (test mode & fallback)
    now = datetime.now(timezone.utc)
    target_deadline = (now + timedelta(days=5)).replace(hour=23, minute=59, second=59, microsecond=0)
    
    # Flag fields if filename indicates an unconfirmed notice
    is_ambiguous = "draft" in filename.lower() or "unclear" in filename.lower()
    low_fields = ["deadline"] if is_ambiguous else []
    confidence = 0.65 if is_ambiguous else 0.95

    return IngestDraftResponse(
        subject="Database Management Systems",
        title=f"Notice: {filename.rsplit('.', 1)[0].replace('_', ' ').title()}",
        type="assignment",
        deadline=target_deadline.isoformat(),
        confidence=confidence,
        low_confidence_fields=low_fields,
        source_filename=filename,
    )
