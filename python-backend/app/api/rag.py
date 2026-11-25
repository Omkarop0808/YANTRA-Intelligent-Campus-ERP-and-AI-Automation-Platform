"""RAG endpoint for querying student notes and reference materials."""

from __future__ import annotations

from typing import Optional
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.core.security import AuthPrincipal, require_auth
from app.services.notes_rag import RagAnswer, search_and_answer

router = APIRouter(prefix="/rag", tags=["RAG"])


class AskNotesRequest(BaseModel):
    query: str = Field(min_length=2, description="The student's question or search query")
    subject: Optional[str] = Field(default=None, description="Optional course subject code to filter notes")


@router.post("/ask-notes", response_model=RagAnswer)
async def ask_notes(
    req: AskNotesRequest,
    principal: AuthPrincipal = Depends(require_auth),
) -> RagAnswer:
    """Ask a question against local course notes and receive an extractive answer with exact citations."""
    return search_and_answer(query=req.query, subject=req.subject)
