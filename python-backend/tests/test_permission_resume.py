"""Offline unit tests for deterministic PermissionCard approval/denial resume.

Verifies that clicking Allow or Deny on a gated write tool executes (or rejects)
the exact tool captured in permission_response.context with ZERO LLM calls and
awaits the /admin/agent-audit log write.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.agents.erp_agent import run_agent
from app.schemas.chat import PermissionResponse


def _principal():
    return SimpleNamespace(
        sub="6b057de7e6f8bb9337d60f47",
        role="teacher",
        raw_token="mock-token",
    )


@pytest.mark.asyncio
async def test_permission_deny_executes_nothing_and_skips_llm():
    resp = PermissionResponse(
        value="deny",
        context={"tool": "create_quiz", "args": {"title": "BST Quiz"}},
    )
    with patch("app.agents.erp_agent._build_graph", return_value=MagicMock()) as mock_graph:
        out = await run_agent(
            message="Deny",
            session_id="sess-deny",
            principal=_principal(),
            token="mock-token",
            permission_response=resp,
        )
    assert "denied" in out.reply.lower()
    assert out.tools_used == []
    mock_graph.return_value.ainvoke.assert_not_called()


@pytest.mark.asyncio
async def test_permission_allow_executes_exact_tool_directly_without_llm():
    fake_tool = MagicMock()
    fake_tool.name = "create_quiz"
    fake_tool.ainvoke = AsyncMock(return_value={"status": "ok", "message": "Created quiz BST Quiz"})

    resp = PermissionResponse(
        value="allow",
        context={
            "tool": "create_quiz",
            "args": {"division_id": "div1", "subject_id": "sub1", "title": "BST Quiz"},
        },
    )
    with (
        patch("app.agents.erp_agent._build_graph", return_value=MagicMock()) as mock_graph,
        patch("app.agents.erp_agent.erp_tools", return_value=[fake_tool]),
    ):
        out = await run_agent(
            message="Allow",
            session_id="sess-allow",
            principal=_principal(),
            token="mock-token",
            permission_response=resp,
        )

    fake_tool.ainvoke.assert_awaited_once_with(
        {"division_id": "div1", "subject_id": "sub1", "title": "BST Quiz"}
    )
    assert out.tools_used == ["create_quiz"]
    assert len(out.steps) == 1
    assert out.steps[0].tool == "create_quiz"
    assert "Created quiz BST Quiz" in out.reply
    mock_graph.return_value.ainvoke.assert_not_called()
