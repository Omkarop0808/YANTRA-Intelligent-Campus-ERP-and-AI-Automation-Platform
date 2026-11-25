"""Yantra ERP MCP Server (Model Context Protocol).

Provides standard MCP stdio access to Yantra ERP capabilities for external
agents, IDEs, and LLMs.
Exposes 8 core tools:
1. list_divisions: List academic divisions.
2. list_subjects: List subjects and course metadata.
3. get_attendance_stats: Get attendance statistics for a division or student.
4. list_quizzes: List scheduled and active quizzes.
5. list_upcoming_deadlines: List upcoming assignments and notice deadlines.
6. get_recovery_plan: Compute attendance recovery requirements to reach 75%.
7. create_announcement: Broadcast an announcement (write tool, requires approval).
8. mark_attendance: Mark lecture attendance (write tool, requires approval).

Authentication:
Receives user JWT via YANTRA_JWT or AUTH_TOKEN environment variable and forwards
it to the Express API so role-based access control (RBAC) is enforced.
"""

from __future__ import annotations

import os
from typing import Any, Optional
import httpx
from mcp.server.fastmcp import FastMCP

mcp = FastMCP(
    "Yantra ERP MCP Server",
    instructions="MCP Server exposing Yantra University ERP tools with RBAC enforcement."
)

EXPRESS_URL = os.getenv("EXPRESS_URL", "http://localhost:3000/api")
REQUIRE_APPROVAL = os.getenv("REQUIRE_TOOL_APPROVAL", "true").lower() in ("true", "1", "yes")


def _get_headers() -> dict[str, str]:
    token = os.getenv("YANTRA_JWT") or os.getenv("AUTH_TOKEN") or os.getenv("JWT_TOKEN")
    if not token:
        return {}
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }


def _check_auth() -> str | None:
    token = os.getenv("YANTRA_JWT") or os.getenv("AUTH_TOKEN") or os.getenv("JWT_TOKEN")
    if not token:
        return "Authentication required. Please set YANTRA_JWT or AUTH_TOKEN environment variable."
    return None


@mcp.tool()
async def list_divisions() -> dict[str, Any]:
    """List all academic divisions (e.g., TE-A, TE-B) with department and year info."""
    auth_err = _check_auth()
    if auth_err:
        return {"error": auth_err}

    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.get(f"{EXPRESS_URL}/academic/divisions", headers=_get_headers())
        if r.status_code != 200:
            return {"error": f"API error {r.status_code}: {r.text}"}
        return r.json()


@mcp.tool()
async def list_subjects() -> dict[str, Any]:
    """List all academic courses and subjects."""
    auth_err = _check_auth()
    if auth_err:
        return {"error": auth_err}

    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.get(f"{EXPRESS_URL}/academic/subjects", headers=_get_headers())
        if r.status_code != 200:
            return {"error": f"API error {r.status_code}: {r.text}"}
        return r.json()


@mcp.tool()
async def get_attendance_stats(division_id: Optional[str] = None) -> dict[str, Any]:
    """Get attendance statistics and analytics for a division or current user."""
    auth_err = _check_auth()
    if auth_err:
        return {"error": auth_err}

    async with httpx.AsyncClient(timeout=10.0) as client:
        url = f"{EXPRESS_URL}/attendance/stats"
        params = {"divisionId": division_id} if division_id else {}
        r = await client.get(url, headers=_get_headers(), params=params)
        if r.status_code != 200:
            return {"error": f"API error {r.status_code}: {r.text}"}
        return r.json()


@mcp.tool()
async def list_quizzes() -> dict[str, Any]:
    """List all quizzes with scheduling and publication status."""
    auth_err = _check_auth()
    if auth_err:
        return {"error": auth_err}

    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.get(f"{EXPRESS_URL}/quizzes", headers=_get_headers())
        if r.status_code != 200:
            return {"error": f"API error {r.status_code}: {r.text}"}
        return r.json()


@mcp.tool()
async def list_upcoming_deadlines() -> dict[str, Any]:
    """List upcoming deadlines including assignments and notice-extracted deadlines."""
    auth_err = _check_auth()
    if auth_err:
        return {"error": auth_err}

    async with httpx.AsyncClient(timeout=10.0) as client:
        # Check student personal deadlines first
        r = await client.get(f"{EXPRESS_URL}/deadlines/personal", headers=_get_headers())
        if r.status_code == 200:
            return r.json()
        return {"deadlines": [], "message": "No active personal deadlines found"}


@mcp.tool()
async def get_recovery_plan(student_id: Optional[str] = None) -> dict[str, Any]:
    """Get attendance recovery planner report showing classes needed to reach 75%."""
    auth_err = _check_auth()
    if auth_err:
        return {"error": auth_err}

    async with httpx.AsyncClient(timeout=10.0) as client:
        url = f"{EXPRESS_URL}/attendance/recovery-plan"
        params = {"studentId": student_id} if student_id else {}
        r = await client.get(url, headers=_get_headers(), params=params)
        if r.status_code != 200:
            return {"error": f"API error {r.status_code}: {r.text}"}
        return r.json()


@mcp.tool()
async def create_announcement(
    division_id: str,
    title: str,
    body: str,
    subject_id: Optional[str] = None,
    confirmed: bool = False,
) -> dict[str, Any]:
    """Broadcast an announcement to students of a division. Write tool gated by approval."""
    auth_err = _check_auth()
    if auth_err:
        return {"error": auth_err}

    if REQUIRE_APPROVAL and not confirmed:
        return {
            "status": "requires_approval",
            "action": "create_announcement",
            "prompt": f"Approval required to broadcast announcement '{title}' to division {division_id}.",
            "payload": {
                "divisionId": division_id,
                "title": title,
                "body": body,
                "subjectId": subject_id,
            },
        }

    async with httpx.AsyncClient(timeout=10.0) as client:
        payload = {
            "divisionId": division_id,
            "title": title,
            "body": body,
        }
        if subject_id:
            payload["subjectId"] = subject_id
        r = await client.post(f"{EXPRESS_URL}/announcements", headers=_get_headers(), json=payload)
        if r.status_code not in (200, 201):
            return {"error": f"API error {r.status_code}: {r.text}"}
        return r.json()


@mcp.tool()
async def mark_attendance(
    lecture_id: str,
    entries: list[dict[str, Any]],
    confirmed: bool = False,
) -> dict[str, Any]:
    """Mark attendance for students in a lecture. Write tool gated by approval."""
    auth_err = _check_auth()
    if auth_err:
        return {"error": auth_err}

    if REQUIRE_APPROVAL and not confirmed:
        return {
            "status": "requires_approval",
            "action": "mark_attendance",
            "prompt": f"Approval required to record attendance for {len(entries)} students in lecture {lecture_id}.",
            "payload": {
                "lectureId": lecture_id,
                "entriesCount": len(entries),
            },
        }

    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.post(
            f"{EXPRESS_URL}/attendance/mark",
            headers=_get_headers(),
            json={"lectureId": lecture_id, "entries": entries},
        )
        if r.status_code not in (200, 201):
            return {"error": f"API error {r.status_code}: {r.text}"}
        return r.json()


if __name__ == "__main__":
    mcp.run(transport="stdio")
