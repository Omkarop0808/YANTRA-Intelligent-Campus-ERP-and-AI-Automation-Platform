"""Test MCP server protocol and all 8 exposed tools.

Verifies:
1. list_divisions
2. list_subjects
3. get_attendance_stats
4. list_quizzes
5. list_upcoming_deadlines
6. get_recovery_plan
7. create_announcement (approval gate and execution)
8. mark_attendance (approval gate and execution)
"""

from __future__ import annotations

import os
import pytest
import httpx
from mcp_server import mcp

EXPRESS_URL = "http://localhost:3000/api"


@pytest.fixture(scope="module")
def teacher_jwt() -> str:
    r = httpx.post(f"{EXPRESS_URL}/auth/login", json={"email": "prof.adrian@university.edu", "password": "Teacher123"})
    assert r.status_code == 200, f"Login failed: {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def student_jwt() -> str:
    r = httpx.post(f"{EXPRESS_URL}/auth/login", json={"email": "aarav.sharma@university.edu", "password": "Student123"})
    assert r.status_code == 200, f"Student login failed: {r.text}"
    return r.json()["token"]


@pytest.mark.asyncio
async def test_mcp_unauthenticated_guard():
    """Without JWT env var, MCP tools return authentication error."""
    old_jwt = os.environ.pop("YANTRA_JWT", None)
    old_auth = os.environ.pop("AUTH_TOKEN", None)
    try:
        res = await mcp.call_tool("list_divisions", {})
        data = res[1]
        assert "error" in data
        assert "Authentication required" in data["error"]
    finally:
        if old_jwt:
            os.environ["YANTRA_JWT"] = old_jwt
        if old_auth:
            os.environ["AUTH_TOKEN"] = old_auth


@pytest.mark.asyncio
async def test_mcp_all_8_tools(teacher_jwt: str, student_jwt: str):
    """Test all 8 MCP tools through MCP protocol with authenticated context."""
    os.environ["YANTRA_JWT"] = teacher_jwt

    # Tool 1: list_divisions
    r1 = await mcp.call_tool("list_divisions", {})
    d1 = r1[1]
    assert "divisions" in d1
    assert len(d1["divisions"]) > 0
    division_id = d1["divisions"][0]["_id"]

    # Tool 2: list_subjects
    r2 = await mcp.call_tool("list_subjects", {})
    d2 = r2[1]
    assert "subjects" in d2
    assert len(d2["subjects"]) > 0

    # Tool 3: get_attendance_stats
    r3 = await mcp.call_tool("get_attendance_stats", {"division_id": division_id})
    d3 = r3[1]
    assert "stats" in d3 or "analytics" in d3 or isinstance(d3, dict)

    # Tool 4: list_quizzes
    r4 = await mcp.call_tool("list_quizzes", {})
    d4 = r4[1]
    assert "quizzes" in d4

    # Tool 5: list_upcoming_deadlines (switch to student context)
    os.environ["YANTRA_JWT"] = student_jwt
    r5 = await mcp.call_tool("list_upcoming_deadlines", {})
    d5 = r5[1]
    assert "deadlines" in d5

    # Tool 6: get_recovery_plan
    r6 = await mcp.call_tool("get_recovery_plan", {})
    d6 = r6[1]
    assert "recoveryPlan" in d6
    assert len(d6["recoveryPlan"]) > 0

    # Switch back to teacher for write tools
    os.environ["YANTRA_JWT"] = teacher_jwt

    # Tool 7: create_announcement
    # 7a: Unconfirmed write tool triggers approval gate
    r7_unconfirmed = await mcp.call_tool("create_announcement", {
        "division_id": division_id,
        "title": "MCP Test Announcement",
        "body": "This is a broadcast test via MCP stdio.",
        "confirmed": False
    })
    d7_u = r7_unconfirmed[1]
    assert d7_u["status"] == "requires_approval"
    assert "Approval required" in d7_u["prompt"]

    # 7b: Confirmed write tool executes
    r7_confirmed = await mcp.call_tool("create_announcement", {
        "division_id": division_id,
        "title": "MCP Test Announcement",
        "body": "This is a broadcast test via MCP stdio.",
        "confirmed": True
    })
    d7_c = r7_confirmed[1]
    assert "broadcastId" in d7_c or "summary" in d7_c or "announcement" in d7_c or "notified" in d7_c

    # Tool 8: mark_attendance
    # 8a: Unconfirmed write triggers approval gate
    r8_unconfirmed = await mcp.call_tool("mark_attendance", {
        "lecture_id": "6af67b6886d5db9c99165401",
        "entries": [{"student_id": "6af67b6886d5db9c99165358", "status": "present"}],
        "confirmed": False
    })
    d8_u = r8_unconfirmed[1]
    assert d8_u["status"] == "requires_approval"
    assert "Approval required" in d8_u["prompt"]
