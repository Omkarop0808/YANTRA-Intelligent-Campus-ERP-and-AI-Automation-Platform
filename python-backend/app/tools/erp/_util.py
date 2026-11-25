"""Shared helpers for ERP tools.

`erp_safe` is the important one: it makes a tool RETURN its error instead of
raising. That matters because LangGraph persists the assistant's tool-call
request to the session before the tool runs; if the tool then raises, no
tool-result message is written and the whole thread becomes invalid
("AIMessage with tool_calls has no corresponding ToolMessage"), poisoning every
later turn. Returning an `{"error": ...}` value keeps the thread valid AND lets
the model react to the failure (e.g. "please attach the file").
"""

from __future__ import annotations

import asyncio
import functools
from collections.abc import Awaitable, Callable
from typing import Any

from app.core.config import get_settings
from app.core.errors import AppError
from app.core.logging import get_logger
from app.integrations.erp_client import ErpApiError
from app.schemas.chat import ChatPermission, ChatPermissionOption

log = get_logger("tools.erp")

WRITE_TOOLS = {
    "mark_attendance",
    "mark_attendance_for_all",
    "create_resource",
    "publish_resource",
    "update_resource",
    "notify_non_submitters",
    "create_quiz",
    "publish_quiz",
    "grade_submission",
    "request_resubmit",
    "publish_proposed_grades",
    "publish_one_grade",
    "send_whatsapp_message",
    "make_reminder_call",
}


def _error_message(e: Exception) -> str:
    """Pull a human-readable message out of an ERP/app error."""
    if isinstance(e, ErpApiError):
        body = e.detail.get("details") if isinstance(e.detail, dict) else None
        msg: Any = None
        if isinstance(body, dict):
            err = body.get("error")
            if isinstance(err, dict):
                msg = err.get("message")
            msg = msg or body.get("message")
        return f"ERP backend rejected the request ({e.status_code}): {msg or body}"
    if isinstance(e, AppError):
        detail = e.detail
        if isinstance(detail, dict):
            return f"Error: {detail.get('message')}"
        return f"Error: {detail}"
    return f"Error: {e}"


def erp_safe(
    func: Callable[..., Awaitable[Any]],
) -> Callable[..., Awaitable[Any]]:
    """Wrap an async tool so any error is RETURNED (not raised). Returning a
    value keeps the LangGraph message history valid and lets the model react.

    NB: the result must NOT use a top-level "error" key — Gemini reserves
    "error"/"output" in a function response (the SDK raises KeyError('error')
    if "error" is present). We use {"status": "error", "message": ...} so the
    whole dict is treated as ordinary function output the model can read.
    """

    @functools.wraps(func)
    async def wrapper(*args: Any, **kwargs: Any) -> Any:
        try:
            from app.agents.run_context import current_run_context
            ctx = current_run_context()
            settings = get_settings()

            # Enforce permission card approval on write/bulk tools if require_tool_approval is enabled
            if settings.require_tool_approval and func.__name__ in WRITE_TOOLS and ctx:
                resp = ctx.permission_response
                if resp is None:
                    ctx.set_permission(
                        ChatPermission(
                            prompt=f"Approval requested for action: {func.__name__}",
                            options=[
                                ChatPermissionOption(value="allow", label="Allow", description=f"Execute {func.__name__}"),
                                ChatPermissionOption(value="deny", label="Deny", description=f"Reject {func.__name__}"),
                            ],
                            context={"tool": func.__name__, "args": kwargs},
                        )
                    )
                    return {
                        "status": "pending_approval",
                        "message": f"PermissionCard displayed. Action {func.__name__} awaits approval.",
                    }
                elif getattr(resp, "value", None) == "deny":
                    return {
                        "status": "rejected",
                        "message": f"Action {func.__name__} was rejected by user. Nothing saved.",
                    }

            result = await func(*args, **kwargs)

            # Record audit row for every tool call (awaited so MongoDB reflects it immediately)
            if ctx:
                try:
                    await ctx.erp().post(
                        "/admin/agent-audit",
                        json={
                            "threadId": "thread-" + str(getattr(ctx.principal, "sub", "anon")),
                            "tool": func.__name__,
                            "args": kwargs,
                            "approvalStatus": "approved" if (resp and getattr(resp, "value", None) == "allow") else "none",
                            "resultStatus": "error" if isinstance(result, dict) and result.get("status") == "error" else "success",
                        },
                    )
                except Exception as audit_err:
                    log.warning("agent audit write failed", tool=func.__name__, error=str(audit_err))

            return result
        except Exception as e:  # noqa: BLE001
            log.warning("tool error", tool=func.__name__, error=str(e))
            return {"status": "error", "message": _error_message(e)}

    return wrapper
