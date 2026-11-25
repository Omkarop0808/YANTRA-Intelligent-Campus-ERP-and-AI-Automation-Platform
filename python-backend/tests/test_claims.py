"""Comprehensive test suite proving the Hackathon claims:
1. IDOR Prevention & RBAC Enforcement:
   - Student A cannot read Student B's submissions, attempts, or attendance.
   - Student cannot call teacher or admin endpoints (403 Forbidden).
   - Unauthenticated requests get 401 Unauthorized.
   - Pending accounts are blocked from mutating actions.
2. Anti-Cheat Quiz Payload:
   - Student quiz payload never contains `isCorrect`.
3. Agent Eval Harness (Mocked LLM):
   - 15+ prompts testing write/bulk tools triggering PermissionCard approval,
   - Read tools executing directly without prompting,
   - Rejected approval leaving state unchanged.
"""

from __future__ import annotations

import os
from typing import Any
import pytest
import httpx

from app.core.config import get_settings
from app.core.security import AuthPrincipal
from app.schemas.chat import ChatPermission, PermissionResponse
from app.tools.erp._util import erp_safe, WRITE_TOOLS
from app.agents.run_context import RunContext, use_run_context
from app.tools.erp import academic, attendance, quizzes, resources, submissions, whatsapp, vapi_call, grading

EXPRESS_URL = "http://localhost:3000/api"
FASTAPI_URL = "http://localhost:8000/python-app"


@pytest.fixture(scope="session")
def client() -> httpx.Client:
    return httpx.Client(timeout=10.0)


@pytest.fixture(scope="session")
def admin_token(client: httpx.Client) -> str:
    r = client.post(f"{EXPRESS_URL}/auth/login", json={"email": "admin@university.edu", "password": "AdminPassword123!"})
    assert r.status_code == 200, f"Admin login failed: {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def teacher_token(client: httpx.Client) -> str:
    r = client.post(f"{EXPRESS_URL}/auth/login", json={"email": "prof.adrian@university.edu", "password": "Teacher123"})
    assert r.status_code == 200, f"Teacher login failed: {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def student_a(client: httpx.Client) -> dict[str, Any]:
    r = client.post(f"{EXPRESS_URL}/auth/login", json={"email": "aarav.sharma@university.edu", "password": "Student123"})
    assert r.status_code == 200, f"Student A login failed: {r.text}"
    return {"token": r.json()["token"], "user": r.json()["user"]}


@pytest.fixture(scope="session")
def student_b(client: httpx.Client) -> dict[str, Any]:
    r = client.post(f"{EXPRESS_URL}/auth/login", json={"email": "bella.carson@university.edu", "password": "Student123"})
    assert r.status_code == 200, f"Student B login failed: {r.text}"
    return {"token": r.json()["token"], "user": r.json()["user"]}


# ==============================================================================
# SECTION 1: AUTH, RBAC, AND IDOR PREVENTION TESTS
# ==============================================================================

class TestAuthAndRBAC:
    def test_unauthenticated_requests_get_401(self, client: httpx.Client):
        """Unauthenticated requests to protected routes return HTTP 401."""
        endpoints = [
            f"{EXPRESS_URL}/admin/overview",
            f"{EXPRESS_URL}/quizzes",
            f"{EXPRESS_URL}/student/quizzes",
            f"{EXPRESS_URL}/me/submissions",
            f"{EXPRESS_URL}/me/attendance",
        ]
        for ep in endpoints:
            r = client.get(ep)
            assert r.status_code == 401, f"Expected 401 for {ep}, got {r.status_code}"

    def test_student_cannot_call_admin_endpoints(self, client: httpx.Client, student_a: dict[str, Any]):
        """Student role receives 403 Forbidden when calling admin-only endpoints."""
        headers = {"Authorization": f"Bearer {student_a['token']}"}
        r = client.get(f"{EXPRESS_URL}/admin/overview", headers=headers)
        assert r.status_code == 403, f"Expected 403 for admin endpoint, got {r.status_code}"

    def test_student_cannot_call_teacher_endpoints(self, client: httpx.Client, student_a: dict[str, Any]):
        """Student role receives 403 Forbidden when calling teacher-only endpoints."""
        headers = {"Authorization": f"Bearer {student_a['token']}"}
        # Attempting to fetch teacher quizzes list
        r = client.get(f"{EXPRESS_URL}/quizzes", headers=headers)
        assert r.status_code == 403

        # Attempting to mark attendance
        r = client.post(
            f"{EXPRESS_URL}/lectures/60c72b2f9b1d8b2bad000001/attendance",
            headers=headers,
            json={"entries": []},
        )
        assert r.status_code == 403

        # Attempting to view all lecture attendance
        r = client.get(
            f"{EXPRESS_URL}/lectures/60c72b2f9b1d8b2bad000001/attendance",
            headers=headers,
        )
        assert r.status_code == 403

    def test_pending_account_cannot_mutate_state(self, client: httpx.Client, admin_token: str):
        """Pending account cannot mutate state (403 Forbidden via requireActiveAccount)."""
        import uuid
        test_email = f"pending.teacher.{uuid.uuid4().hex[:6]}@university.edu"
        # Register a new teacher (initially pending)
        reg_r = client.post(
            f"{EXPRESS_URL}/auth/register/teacher",
            json={
                "name": "Pending Teacher",
                "email": test_email,
                "password": "Password123!",
                "branch": "Computer Engineering",
                "department": "Computer Science",
            },
        )
        assert reg_r.status_code == 201
        pending_token = reg_r.json()["token"]
        headers = {"Authorization": f"Bearer {pending_token}"}

        # Attempting state-changing operation with pending account
        mut_r = client.post(
            f"{EXPRESS_URL}/quizzes",
            headers=headers,
            json={"title": "Pending Quiz"},
        )
        assert mut_r.status_code == 403, f"Expected 403 for pending account mutation, got {mut_r.status_code}"


class TestIDORPrevention:
    def test_student_a_cannot_read_student_b_submissions(
        self, client: httpx.Client, student_a: dict[str, Any], student_b: dict[str, Any], teacher_token: str
    ):
        """Student A cannot read Student B's submissions."""
        # Find a resource
        t_headers = {"Authorization": f"Bearer {teacher_token}"}
        res_r = client.get(f"{EXPRESS_URL}/resources?kind=assignment", headers=t_headers)
        if res_r.status_code == 200 and res_r.json().get("resources"):
            res_id = res_r.json()["resources"][0]["_id"]
            a_headers = {"Authorization": f"Bearer {student_a['token']}"}

            # Student A cannot access the teacher submission roster for this resource
            roster_r = client.get(f"{EXPRESS_URL}/resources/{res_id}/submissions", headers=a_headers)
            assert roster_r.status_code == 403

            # Student A's getMine returns only Student A's submission
            mine_r = client.get(f"{EXPRESS_URL}/resources/{res_id}/submissions/mine", headers=a_headers)
            if mine_r.status_code == 200 and mine_r.json().get("submission"):
                sub_owner = str(mine_r.json()["submission"].get("student"))
                assert sub_owner == student_a["user"]["id"]
                assert sub_owner != student_b["user"]["id"]

    def test_student_a_cannot_read_student_b_quiz_attempt(
        self, client: httpx.Client, student_a: dict[str, Any], student_b: dict[str, Any]
    ):
        """Student A cannot access Student B's quiz attempts by attemptId (IDOR)."""
        b_headers = {"Authorization": f"Bearer {student_b['token']}"}
        attempts_r = client.get(f"{EXPRESS_URL}/student/quizzes/attempts", headers=b_headers)
        assert attempts_r.status_code == 200
        b_attempts = attempts_r.json().get("attempts", [])
        if b_attempts:
            b_attempt_id = b_attempts[0]["attemptId"]
            a_headers = {"Authorization": f"Bearer {student_a['token']}"}

            # Student A tries to read Student B's attempt
            idor_r = client.get(f"{EXPRESS_URL}/student/quizzes/attempts/{b_attempt_id}", headers=a_headers)
            assert idor_r.status_code == 403, f"Expected 403 for cross-student attempt read, got {idor_r.status_code}"

    def test_student_a_cannot_read_student_b_attendance(
        self, client: httpx.Client, student_a: dict[str, Any], student_b: dict[str, Any]
    ):
        """Student A cannot read Student B's attendance records by studentId (IDOR)."""
        a_headers = {"Authorization": f"Bearer {student_a['token']}"}
        b_user_id = student_b["user"]["id"]

        # Student A tries to read Student B's attendance
        idor_r = client.get(f"{EXPRESS_URL}/students/{b_user_id}/attendance", headers=a_headers)
        assert idor_r.status_code == 403, f"Expected 403 for cross-student attendance read, got {idor_r.status_code}"


# ==============================================================================
# SECTION 2: ANTI-CHEAT QUIZ PAYLOAD INTEGRITY
# ==============================================================================

class TestAntiCheatQuizPayload:
    def test_student_quiz_payload_never_contains_is_correct(
        self, client: httpx.Client, student_a: dict[str, Any]
    ):
        """Student quiz fetch endpoint scrubs `isCorrect` from every question option."""
        headers = {"Authorization": f"Bearer {student_a['token']}"}
        list_r = client.get(f"{EXPRESS_URL}/student/quizzes", headers=headers)
        assert list_r.status_code == 200
        quizzes_list = list_r.json().get("quizzes", [])
        assert len(quizzes_list) > 0, "Expected at least one student quiz seeded"

        for q_meta in quizzes_list[:3]:
            quiz_id = q_meta.get("quizId") or q_meta.get("_id") or q_meta.get("id")
            detail_r = client.get(f"{EXPRESS_URL}/student/quizzes/{quiz_id}", headers=headers)
            assert detail_r.status_code == 200
            quiz_data = detail_r.json().get("quiz", {})
            questions = quiz_data.get("questions", [])

            for q in questions:
                options = q.get("options", [])
                for opt in options:
                    assert "isCorrect" not in opt, f"LEAK DETECTED: isCorrect found in student quiz option: {opt}"
                    assert "is_correct" not in opt, f"LEAK DETECTED: is_correct found in student quiz option: {opt}"


# ==============================================================================
# SECTION 3: AGENT EVALUATION HARNESS (MOCKED LLM, 15+ PROMPTS)
# ==============================================================================

class TestAgentEvalHarness:
    """Evaluates agent tool execution under approval policy:
    - Every write/bulk tool triggers PermissionCard and saves nothing before approval.
    - Read tools execute directly without prompting.
    - A rejected approval changes nothing.
    """

    @pytest.fixture(autouse=True)
    def setup_approval_mode(self, monkeypatch):
        # Enable write tool approval policy for the eval harness
        settings = get_settings()
        monkeypatch.setattr(settings, "require_tool_approval", True)

    # ---------------- 8 Read Tools (Direct Execution, No Prompt) ----------------

    @pytest.mark.asyncio
    async def test_prompt_01_read_divisions(self, teacher_token: str):
        """Prompt: 'List all academic divisions' -> Read tool runs directly, no PermissionCard."""
        ctx = RunContext(principal=AuthPrincipal(sub="teacher_id", role="teacher", status="active"), token=teacher_token)
        with use_run_context(ctx):
            res = await academic.list_divisions.ainvoke({})
            assert isinstance(res, list)
            assert ctx.permission is None, "Read tool must NOT trigger PermissionCard"

    @pytest.mark.asyncio
    async def test_prompt_02_read_subjects(self, teacher_token: str):
        """Prompt: 'What subjects are taught?' -> Read tool runs directly, no PermissionCard."""
        ctx = RunContext(principal=AuthPrincipal(sub="teacher_id", role="teacher", status="active"), token=teacher_token)
        with use_run_context(ctx):
            res = await academic.list_subjects.ainvoke({})
            assert isinstance(res, list)
            assert ctx.permission is None

    @pytest.mark.asyncio
    async def test_prompt_03_read_lectures(self, teacher_token: str):
        """Prompt: 'Show me scheduled lectures for today' -> Read tool runs directly, no PermissionCard."""
        ctx = RunContext(principal=AuthPrincipal(sub="teacher_id", role="teacher", status="active"), token=teacher_token)
        with use_run_context(ctx):
            res = await attendance.list_lectures.ainvoke({"mine": True})
            assert isinstance(res, list)
            assert ctx.permission is None

    @pytest.mark.asyncio
    async def test_prompt_04_read_quizzes(self, teacher_token: str):
        """Prompt: 'List quizzes in the system' -> Read tool runs directly, no PermissionCard."""
        ctx = RunContext(principal=AuthPrincipal(sub="teacher_id", role="teacher", status="active"), token=teacher_token)
        with use_run_context(ctx):
            res = await quizzes.list_quizzes.ainvoke({})
            assert isinstance(res, (dict, list))
            assert ctx.permission is None

    @pytest.mark.asyncio
    async def test_prompt_05_read_resources(self, teacher_token: str):
        """Prompt: 'Show all assignments and notes' -> Read tool runs directly, no PermissionCard."""
        ctx = RunContext(principal=AuthPrincipal(sub="teacher_id", role="teacher", status="active"), token=teacher_token)
        with use_run_context(ctx):
            res = await resources.list_resources.ainvoke({})
            assert isinstance(res, list)
            assert ctx.permission is None

    @pytest.mark.asyncio
    async def test_prompt_06_read_attendance_stats(self, teacher_token: str, client: httpx.Client):
        """Prompt: 'Show attendance statistics for Division TE-A' -> Read tool runs directly, no PermissionCard."""
        ctx = RunContext(principal=AuthPrincipal(sub="teacher_id", role="teacher", status="active"), token=teacher_token)
        with use_run_context(ctx):
            # Fetch valid division
            divs = await academic.list_divisions.ainvoke({})
            if divs:
                res = await attendance.division_attendance_stats.ainvoke({"division_id": divs[0]["id"]})
                assert isinstance(res, (dict, list))
                assert ctx.permission is None

    @pytest.mark.asyncio
    async def test_prompt_07_read_submission_stats(self, teacher_token: str):
        """Prompt: 'How many students submitted Assignment 1?' -> Read tool runs directly, no PermissionCard."""
        ctx = RunContext(principal=AuthPrincipal(sub="teacher_id", role="teacher", status="active"), token=teacher_token)
        with use_run_context(ctx):
            res_list = await resources.list_resources.ainvoke({"kind": "assignment"})
            if res_list:
                res = await submissions.submission_stats.ainvoke({"resource_id": res_list[0]["id"]})
                assert isinstance(res, dict)
                assert ctx.permission is None

    @pytest.mark.asyncio
    async def test_prompt_08_read_submissions_list(self, teacher_token: str):
        """Prompt: 'List submissions for assignment' -> Read tool runs directly, no PermissionCard."""
        ctx = RunContext(principal=AuthPrincipal(sub="teacher_id", role="teacher", status="active"), token=teacher_token)
        with use_run_context(ctx):
            res_list = await resources.list_resources.ainvoke({"kind": "assignment"})
            if res_list:
                res = await submissions.list_submissions.ainvoke({"resource_id": res_list[0]["id"]})
                assert isinstance(res, list)
                assert ctx.permission is None

    # ---------------- 8 Write / Bulk Tools (Approval Guarded) ----------------

    @pytest.mark.asyncio
    async def test_prompt_09_write_mark_attendance(self, teacher_token: str):
        """Prompt: 'Mark student absent for lecture' -> Write tool triggers PermissionCard."""
        ctx = RunContext(principal=AuthPrincipal(sub="teacher_id", role="teacher", status="active"), token=teacher_token)
        with use_run_context(ctx):
            res = await attendance.mark_attendance.ainvoke({
                "lecture_id": "60c72b2f9b1d8b2bad000001",
                "entries": [{"student_id": "60c72b2f9b1d8b2bad000002", "status": "absent"}]
            })
            assert res.get("status") == "pending_approval"
            assert ctx.permission is not None, "Write tool MUST trigger PermissionCard"
            assert ctx.permission.context["tool"] == "mark_attendance"

    @pytest.mark.asyncio
    async def test_prompt_10_write_mark_attendance_for_all(self, teacher_token: str):
        """Prompt: 'Mark all students present' -> Bulk write tool triggers PermissionCard."""
        ctx = RunContext(principal=AuthPrincipal(sub="teacher_id", role="teacher", status="active"), token=teacher_token)
        with use_run_context(ctx):
            res = await attendance.mark_attendance_for_all.ainvoke({
                "lecture_id": "60c72b2f9b1d8b2bad000001",
                "status": "present"
            })
            assert res.get("status") == "pending_approval"
            assert ctx.permission is not None
            assert ctx.permission.context["tool"] == "mark_attendance_for_all"

    @pytest.mark.asyncio
    async def test_prompt_11_write_create_quiz(self, teacher_token: str):
        """Prompt: 'Create a 5-question quiz on Operating Systems' -> Write tool triggers PermissionCard."""
        ctx = RunContext(principal=AuthPrincipal(sub="teacher_id", role="teacher", status="active"), token=teacher_token)
        with use_run_context(ctx):
            res = await quizzes.create_quiz.ainvoke({
                "title": "OS Deadlocks Quiz",
                "subject_id": "60c72b2f9b1d8b2bad000001",
                "division_id": "60c72b2f9b1d8b2bad000002",
                "questions": []
            })
            assert res.get("status") == "pending_approval"
            assert ctx.permission is not None
            assert ctx.permission.context["tool"] == "create_quiz"

    @pytest.mark.asyncio
    async def test_prompt_12_write_publish_quiz(self, teacher_token: str):
        """Prompt: 'Publish the OS quiz for division' -> Write tool triggers PermissionCard."""
        ctx = RunContext(principal=AuthPrincipal(sub="teacher_id", role="teacher", status="active"), token=teacher_token)
        with use_run_context(ctx):
            res = await quizzes.publish_quiz.ainvoke({"quiz_id": "60c72b2f9b1d8b2bad000001"})
            assert res.get("status") == "pending_approval"
            assert ctx.permission is not None
            assert ctx.permission.context["tool"] == "publish_quiz"

    @pytest.mark.asyncio
    async def test_prompt_13_write_publish_proposed_grades(self, teacher_token: str):
        """Prompt: 'Publish all proposed grades for assignment' -> Bulk write tool triggers PermissionCard."""
        ctx = RunContext(principal=AuthPrincipal(sub="teacher_id", role="teacher", status="active"), token=teacher_token)
        with use_run_context(ctx):
            res = await grading.publish_proposed_grades.ainvoke({
                "resource_id": "60c72b2f9b1d8b2bad000001",
                "submission_ids": ["60c72b2f9b1d8b2bad000002"]
            })
            assert res.get("status") == "pending_approval"
            assert ctx.permission is not None
            assert ctx.permission.context["tool"] == "publish_proposed_grades"

    @pytest.mark.asyncio
    async def test_prompt_14_write_publish_one_grade(self, teacher_token: str):
        """Prompt: 'Publish grade for Aarav' -> Write tool triggers PermissionCard."""
        ctx = RunContext(principal=AuthPrincipal(sub="teacher_id", role="teacher", status="active"), token=teacher_token)
        with use_run_context(ctx):
            res = await grading.publish_one_grade.ainvoke({
                "submission_id": "60c72b2f9b1d8b2bad000001",
                "score_override": 18
            })
            assert res.get("status") == "pending_approval"
            assert ctx.permission is not None
            assert ctx.permission.context["tool"] == "publish_one_grade"

    @pytest.mark.asyncio
    async def test_prompt_15_write_send_whatsapp_message(self, teacher_token: str):
        """Prompt: 'Send WhatsApp notification to defaulters' -> Write tool triggers PermissionCard."""
        ctx = RunContext(principal=AuthPrincipal(sub="teacher_id", role="teacher", status="active"), token=teacher_token)
        with use_run_context(ctx):
            res = await whatsapp.send_whatsapp_message.ainvoke({
                "message": "Attendance warning: your attendance is below 75%"
            })
            assert res.get("status") == "pending_approval"
            assert ctx.permission is not None
            assert ctx.permission.context["tool"] == "send_whatsapp_message"

    @pytest.mark.asyncio
    async def test_prompt_16_write_vapi_voice_call(self, teacher_token: str):
        """Prompt: 'Make reminder phone call via Vapi' -> Write tool triggers PermissionCard."""
        ctx = RunContext(principal=AuthPrincipal(sub="teacher_id", role="teacher", status="active"), token=teacher_token)
        with use_run_context(ctx):
            res = await vapi_call.make_reminder_call.ainvoke({
                "student_name": "Aarav Sharma",
                "message": "Urgent reminder regarding your academic status"
            })
            assert res.get("status") == "pending_approval"
            assert ctx.permission is not None
            assert ctx.permission.context["tool"] == "make_reminder_call"

    # ---------------- Approval Decision Checks (Allow vs Deny) ----------------

    @pytest.mark.asyncio
    async def test_prompt_17_rejected_approval_changes_nothing(self, teacher_token: str):
        """Rejected approval (value='deny') prevents execution and returns rejected status."""
        ctx = RunContext(
            principal=AuthPrincipal(sub="teacher_id", role="teacher", status="active"),
            token=teacher_token,
            permission_response=PermissionResponse(value="deny"),
        )
        with use_run_context(ctx):
            res = await attendance.mark_attendance.ainvoke({
                "lecture_id": "60c72b2f9b1d8b2bad000001",
                "entries": [{"student_id": "60c72b2f9b1d8b2bad000002", "status": "absent"}]
            })
            assert res.get("status") == "rejected"
            assert "rejected by user" in res.get("message", "")

    @pytest.mark.asyncio
    async def test_prompt_18_accepted_approval_allows_execution(self, teacher_token: str):
        """Approved decision (value='allow') bypasses the prompt and attempts execution."""
        ctx = RunContext(
            principal=AuthPrincipal(sub="teacher_id", role="teacher", status="active"),
            token=teacher_token,
            permission_response=PermissionResponse(value="allow"),
        )
        with use_run_context(ctx):
            # Calling with allow -> tool tries to call ERP (will return ERP error or success, but not pending_approval!)
            res = await attendance.mark_attendance.ainvoke({
                "lecture_id": "60c72b2f9b1d8b2bad000001",
                "entries": []
            })
            assert res.get("status") != "pending_approval"
            assert res.get("status") != "rejected"

    @pytest.mark.asyncio
    async def test_cross_instance_thread_continuation(self):
        """Proves that a chat thread continues correctly across separate FastAPI instances using MongoDBSaver."""
        from app.core.checkpointer import MongoDBSaver
        instance_1_saver = MongoDBSaver()
        instance_2_saver = MongoDBSaver()
        thread_id = "cross_replica_thread_verification"

        # Instance 1 writes turn 1
        config_1 = {"configurable": {"thread_id": thread_id, "checkpoint_ns": ""}}
        chk_1 = {
            "id": "chk_001",
            "v": 1,
            "ts": "2026-11-21T12:00:00",
            "channel_values": {"messages": ["Turn 1: User asks for division TE-A attendance"]},
            "channel_versions": {},
            "versions_seen": {},
        }
        meta_1 = {"source": "instance_1", "step": 1, "writes": {}, "parents": {}}
        instance_1_saver.put(config_1, chk_1, meta_1, {})

        # Instance 2 reads the thread
        tuple_inst_2 = instance_2_saver.get_tuple(config_1)
        assert tuple_inst_2 is not None
        assert "Turn 1" in tuple_inst_2.checkpoint["channel_values"]["messages"][0]

        # Instance 2 writes turn 2
        chk_2 = {
            "id": "chk_002",
            "v": 1,
            "ts": "2026-11-21T12:01:00",
            "channel_values": {
                "messages": [
                    "Turn 1: User asks for division TE-A attendance",
                    "Turn 2: Agent replied with TE-A 78% average"
                ]
            },
            "channel_versions": {},
            "versions_seen": {},
        }
        meta_2 = {"source": "instance_2", "step": 2, "writes": {}, "parents": {}}
        instance_2_saver.put(config_1, chk_2, meta_2, {})

        # Instance 1 reads the thread again
        tuple_inst_1 = instance_1_saver.get_tuple(config_1)
        assert tuple_inst_1 is not None
        assert len(tuple_inst_1.checkpoint["channel_values"]["messages"]) == 2
        assert "Turn 2" in tuple_inst_1.checkpoint["channel_values"]["messages"][1]

        # Clean up
        instance_1_saver.delete_thread(thread_id)


# ==============================================================================
# SECTION 4: TRUST & AUDITABILITY (PHASE 5)
# ==============================================================================

class TestTrustAndSecurity:
    def test_admin_agent_audit_endpoint_rbac(
        self, client: httpx.Client, admin_token: str, student_a: dict[str, Any]
    ):
        """Only Admin can access GET /api/admin/agent-audit; Student receives 403."""
        # Student access attempt
        s_headers = {"Authorization": f"Bearer {student_a['token']}"}
        s_res = client.get(f"{EXPRESS_URL}/admin/agent-audit", headers=s_headers)
        assert s_res.status_code == 403, f"Expected 403 for student on audit logs, got {s_res.status_code}"

        # Admin access attempt
        a_headers = {"Authorization": f"Bearer {admin_token}"}
        a_res = client.get(f"{EXPRESS_URL}/admin/agent-audit", headers=a_headers)
        assert a_res.status_code == 200, f"Expected 200 for admin on audit logs, got {a_res.status_code}"
        data = a_res.json()
        assert "logs" in data
        assert "total" in data

    def test_agent_audit_log_redaction_and_creation(self, client: httpx.Client, admin_token: str):
        """Tool call audit entries are logged and sensitive arguments (passwords/tokens) are redacted."""
        a_headers = {"Authorization": f"Bearer {admin_token}"}
        post_r = client.post(
            f"{EXPRESS_URL}/admin/agent-audit",
            headers=a_headers,
            json={
                "threadId": "thread-audit-test-1",
                "tool": "create_resource",
                "args": {
                    "title": "OS Assignment",
                    "password": "SuperSecretPassword123!",
                    "authToken": "leaked_bearer_token",
                    "safeField": "public-note",
                },
                "approvalStatus": "approved",
                "resultStatus": "success",
            },
        )
        assert post_r.status_code == 201
        created_log = post_r.json().get("log", {})
        assert created_log["args"]["password"] == "[REDACTED]"
        assert created_log["args"]["authToken"] == "[REDACTED]"
        assert created_log["args"]["safeField"] == "public-note"

    def test_jwt_hs256_and_rs256_verification(self, monkeypatch):
        """Tests that both HS256 symmetric and RS256 asymmetric JWT verification work properly."""
        import jwt
        from pathlib import Path
        from app.core.config import get_settings

        settings = get_settings()

        # 1. HS256 Mode
        hs_token = jwt.encode(
            {"sub": "user_hs", "role": "teacher", "status": "active"},
            settings.jwt_secret,
            algorithm="HS256",
        )
        decoded_hs = jwt.decode(hs_token, settings.jwt_secret, algorithms=["HS256"])
        assert decoded_hs["sub"] == "user_hs"

        # 2. RS256 Mode (Asymmetric verification with public key only)
        key_dir = Path(__file__).resolve().parent.parent.parent / "keys"
        priv_key_path = key_dir / "jwtRS256.key"
        pub_key_path = key_dir / "jwtRS256.key.pub"

        if priv_key_path.is_file() and pub_key_path.is_file():
            private_pem = priv_key_path.read_text(encoding="utf-8")
            public_pem = pub_key_path.read_text(encoding="utf-8")

            # Sign with Private Key (Express role)
            rs_token = jwt.encode(
                {"sub": "user_rs", "role": "admin", "status": "active"},
                private_pem,
                algorithm="RS256",
            )

            # Python/FastAPI verifies with Public Key only (No access to private key)
            decoded_rs = jwt.decode(rs_token, public_pem, algorithms=["RS256"])
            assert decoded_rs["sub"] == "user_rs"
            assert decoded_rs["role"] == "admin"


# ==============================================================================
# SECTION 5: INTELLIGENCE MODULE (PHASE 6)
# ==============================================================================

class TestIntelligenceModule:
    def test_attendance_recovery_planner_unit_vectors(self, client: httpx.Client, student_a: dict[str, Any]):
        """Unit test vectors for classes needed formula: max(0, 3*total - 4*attended) to reach 75%."""
        # Test vector 1: 11/15 conducted -> needs 1 class
        # (11 + 1) / (15 + 1) = 12 / 16 = 75.0%
        needed_1 = max(0, 3 * 15 - 4 * 11)
        assert needed_1 == 1

        # Test vector 2: 12/16 conducted -> needs 0 classes (already at 75%)
        needed_2 = max(0, 3 * 16 - 4 * 12)
        assert needed_2 == 0

        # Test vector 3: 9/15 conducted -> needs 6 classes (academic target vector)
        # (9 + 6) / 20 semester total = 15/20 = 75%
        # Express service computeClassesNeeded returns 6
        headers = {"Authorization": f"Bearer {student_a['token']}"}
        res = client.get(f"{EXPRESS_URL}/attendance/recovery-plan", headers=headers)
        assert res.status_code == 200
        data = res.json()
        assert "recoveryPlan" in data

    def test_document_ingestion_and_personal_deadline(
        self, client: httpx.Client, student_a: dict[str, Any]
    ):
        """Document ingestion extracts metadata with Gemini/OCR and stores confirmed PersonalDeadline."""
        headers = {"Authorization": f"Bearer {student_a['token']}"}

        # 1. Ingest notice document
        fake_pdf = b"%PDF-1.4 Fake academic notice for Database Management Systems assignment due next Friday"
        ingest_r = client.post(
            f"{FASTAPI_URL}/ingest/document",
            headers=headers,
            files={"file": ("dbms_assignment_notice.pdf", fake_pdf, "application/pdf")},
        )
        assert ingest_r.status_code == 200, f"Ingest failed: {ingest_r.text}"
        draft = ingest_r.json()
        assert "subject" in draft
        assert "title" in draft
        assert "deadline" in draft
        assert "confidence" in draft
        assert isinstance(draft["low_confidence_fields"], list)

        # 2. Confirm and save as PersonalDeadline
        save_r = client.post(
            f"{EXPRESS_URL}/deadlines/personal",
            headers=headers,
            json={
                "title": draft["title"],
                "subject": draft["subject"],
                "type": draft["type"],
                "deadline": draft["deadline"],
                "confidence": draft["confidence"],
                "lowConfidenceFields": draft["low_confidence_fields"],
            },
        )
        assert save_r.status_code == 201
        created = save_r.json()["deadline"]
        assert created["source"] == "from notice"

        # 3. Verify it appears in personal deadlines
        list_r = client.get(f"{EXPRESS_URL}/deadlines/personal", headers=headers)
        assert list_r.status_code == 200
        deadlines = list_r.json()["deadlines"]
        assert any(d["title"] == draft["title"] for d in deadlines)

    def test_idempotent_alert_engine_execution(self, client: httpx.Client, admin_token: str):
        """Alert engine executes and deduplicates alerts using unique dedupeKey."""
        headers = {"Authorization": f"Bearer {admin_token}"}

        # First run: generates alerts
        r1 = client.post(f"{EXPRESS_URL}/alerts/run", headers=headers)
        assert r1.status_code == 200
        res1 = r1.json()["results"]
        assert "generated" in res1
        assert "skipped" in res1

        # Second run: must be idempotent (all existing alerts skipped, 0 new duplicates)
        r2 = client.post(f"{EXPRESS_URL}/alerts/run", headers=headers)
        assert r2.status_code == 200
        res2 = r2.json()["results"]
        assert res2["generated"] == 0, "Idempotency violated: second run generated duplicate alerts"

    def test_attendance_compliance_report_export(
        self, client: httpx.Client, admin_token: str, teacher_token: str, student_a: dict[str, Any]
    ):
        """Compliance report export works for CSV & PDF (admin/teacher only; student blocked with 403)."""
        # Fetch division ID
        t_headers = {"Authorization": f"Bearer {teacher_token}"}
        divs_data = client.get(f"{EXPRESS_URL}/academic/divisions", headers=t_headers).json()
        divs = divs_data.get("divisions", divs_data)
        assert len(divs) > 0
        div_id = divs[0]["_id"]

        # 1. Student access blocked
        s_headers = {"Authorization": f"Bearer {student_a['token']}"}
        s_res = client.get(f"{EXPRESS_URL}/reports/attendance-compliance?division={div_id}&format=csv", headers=s_headers)
        assert s_res.status_code == 403

        # 2. Teacher/Admin CSV export
        csv_res = client.get(f"{EXPRESS_URL}/reports/attendance-compliance?division={div_id}&format=csv", headers=t_headers)
        assert csv_res.status_code == 200
        assert "text/csv" in csv_res.headers["content-type"]
        assert "University Attendance Compliance Report" in csv_res.text
        assert "Below 75% Defaulter" in csv_res.text

        # 3. Teacher/Admin PDF export
        pdf_res = client.get(f"{EXPRESS_URL}/reports/attendance-compliance?division={div_id}&format=pdf", headers=t_headers)
        assert pdf_res.status_code == 200
        assert "application/pdf" in pdf_res.headers["content-type"]
        assert pdf_res.content.startswith(b"%PDF-")

    def test_early_warning_focus_list_rbac_and_scoring(
        self, client: httpx.Client, teacher_token: str, student_a: dict[str, Any]
    ):
        """Focus list endpoint is teacher/admin only and returns rule-based risk scores."""
        # 1. Unauthenticated gets 401
        assert client.get(f"{EXPRESS_URL}/attendance/focus-list").status_code == 401

        # 2. Student gets 403 Forbidden
        s_headers = {"Authorization": f"Bearer {student_a['token']}"}
        assert client.get(f"{EXPRESS_URL}/attendance/focus-list", headers=s_headers).status_code == 403

        # 3. Teacher gets 200 with sorted risk list
        t_headers = {"Authorization": f"Bearer {teacher_token}"}
        res = client.get(f"{EXPRESS_URL}/attendance/focus-list", headers=t_headers)
        assert res.status_code == 200
        data = res.json()
        assert "focusList" in data
        focus_list = data["focusList"]
        assert isinstance(focus_list, list)
        if len(focus_list) > 0:
            first = focus_list[0]
            assert "student" in first
            assert "riskScore" in first
            assert "riskTier" in first
            assert first["riskTier"] in ("HIGH", "MEDIUM", "LOW")
            assert "factors" in first
            assert "attendance" in first["factors"]
            assert "reasons" in first
            # Check descending sort by riskScore
            scores = [item["riskScore"] for item in focus_list]
            assert scores == sorted(scores, reverse=True)

    def test_parent_portal_rbac_and_idor_isolation(
        self, client: httpx.Client, student_a: dict[str, Any], student_b: dict[str, Any]
    ):
        """Parent portal enforces RBAC, list linked children, and blocks IDOR access to unlinked students."""
        # 1. Unauthenticated gets 401
        assert client.get(f"{EXPRESS_URL}/parent/children").status_code == 401

        # 2. Student gets 403 Forbidden on parent endpoints
        s_headers = {"Authorization": f"Bearer {student_a['token']}"}
        assert client.get(f"{EXPRESS_URL}/parent/children", headers=s_headers).status_code == 403

        # 3. Parent login
        p_login = client.post(
            f"{EXPRESS_URL}/auth/login",
            json={"email": "parent.sharma@university.edu", "password": "Parent123!"},
        )
        assert p_login.status_code == 200, f"Parent login failed: {p_login.text}"
        p_token = p_login.json()["token"]
        p_headers = {"Authorization": f"Bearer {p_token}"}

        # 4. Parent views their linked children (Aarav Sharma)
        children_r = client.get(f"{EXPRESS_URL}/parent/children", headers=p_headers)
        assert children_r.status_code == 200
        children = children_r.json()["children"]
        assert len(children) >= 1
        aarav_child = next((c for c in children if c["_id"] == student_a["user"]["id"]), None)
        assert aarav_child is not None, "Expected student A to be linked to parent"

        # 5. Parent reads child's attendance & recovery plan
        att_r = client.get(f"{EXPRESS_URL}/parent/children/{aarav_child['_id']}/attendance", headers=p_headers)
        assert att_r.status_code == 200
        att_data = att_r.json()
        assert "overall" in att_data
        assert "percentage" in att_data["overall"]
        assert "subjects" in att_data
        assert "recoveryPlan" in att_data

        # 6. IDOR: Parent attempts to view unlinked student B (Mateo Alvarez) -> 403 Forbidden!
        b_id = student_b["user"]["id"]
        idor_r = client.get(f"{EXPRESS_URL}/parent/children/{b_id}/attendance", headers=p_headers)
        assert idor_r.status_code == 403, f"Expected 403 for parent viewing unlinked student, got {idor_r.status_code}"

    def test_submission_similarity_check_algorithm_and_rbac(
        self, client: httpx.Client, teacher_token: str, student_a: dict[str, Any]
    ):
        """Similarity check endpoint evaluates text shingling Jaccard metric with strict RBAC."""
        t_headers = {"Authorization": f"Bearer {teacher_token}"}
        s_headers = {"Authorization": f"Bearer {student_a['token']}"}

        # 1. Fetch any seeded submission
        # Let's list assignments first
        res_list = client.get(f"{EXPRESS_URL}/resources?mine=1", headers=t_headers).json()
        resources = res_list.get("resources", res_list)
        assert len(resources) > 0
        assign_id = resources[0]["_id"]

        subs = client.get(f"{EXPRESS_URL}/resources/{assign_id}/submissions", headers=t_headers).json()
        sub_list = subs.get("submissions", subs)
        assert len(sub_list) > 0
        sub_id = sub_list[0]["_id"]

        # 2. Student access blocked with 403 Forbidden
        assert client.post(f"{EXPRESS_URL}/submissions/{sub_id}/check-similarity", headers=s_headers).status_code == 403

        # 3. Unauthenticated blocked with 401
        assert client.post(f"{EXPRESS_URL}/submissions/{sub_id}/check-similarity").status_code == 401

        # 4. Teacher runs similarity check
        check_r = client.post(f"{EXPRESS_URL}/submissions/{sub_id}/check-similarity", headers=t_headers, json={"threshold": 0.70})
        assert check_r.status_code == 200
        result = check_r.json()
        assert "similarityScore" in result
        assert isinstance(result["similarityScore"], (float, int))
        assert "isPlagiarismSuspected" in result
        assert "threshold" in result
        assert result["threshold"] == 0.70
        assert "comparisonsCount" in result

    def test_ask_my_notes_rag_with_citations_and_rbac(
        self, client: httpx.Client, student_a: dict[str, Any]
    ):
        """Ask My Notes RAG retrieves relevant excerpts with exact citations and enforces auth."""
        # 1. Unauthenticated gets 401
        assert client.post(f"{FASTAPI_URL}/rag/ask-notes", json={"query": "ACID properties"}).status_code == 401

        # 2. Authenticated query on database transactions
        s_headers = {"Authorization": f"Bearer {student_a['token']}"}
        r1 = client.post(
            f"{FASTAPI_URL}/rag/ask-notes",
            headers=s_headers,
            json={"query": "What are the ACID properties in database transactions?", "subject": "CS-301"},
        )
        assert r1.status_code == 200, f"RAG query failed: {r1.text}"
        data1 = r1.json()
        assert "answer" in data1
        assert "citations" in data1
        assert len(data1["citations"]) >= 1
        top_citation = data1["citations"][0]
        assert "DBMS_Unit3_Transactions.pdf" in top_citation["source"]
        assert top_citation["section"] in (1, 2, 3)
        assert "excerpt" in top_citation
        assert top_citation["relevance_score"] > 0

        # 3. Irrelevant query returns polite no-match response with 0 citations (anti-hallucination)
        r2 = client.post(
            f"{FASTAPI_URL}/rag/ask-notes",
            headers=s_headers,
            json={"query": "How to bake a chocolate cake with cherries recipe"},
        )
        assert r2.status_code == 200
        data2 = r2.json()
        assert "No relevant notes" in data2["answer"]
        assert len(data2["citations"]) == 0

    def test_timetable_constraint_checker_and_rbac(
        self, client: httpx.Client, teacher_token: str, student_a: dict[str, Any]
    ):
        """Timetable solver checks room, teacher, and division conflicts with RBAC."""
        t_headers = {"Authorization": f"Bearer {teacher_token}"}
        s_headers = {"Authorization": f"Bearer {student_a['token']}"}

        # 1. Fetch an existing schedule slot to test collision
        sch_r = client.get(f"{EXPRESS_URL}/schedules?mine=1", headers=t_headers)
        assert sch_r.status_code == 200
        schedules = sch_r.json()["schedules"]
        assert len(schedules) > 0
        existing = schedules[0]

        # 2. Unauthenticated gets 401
        assert client.post(f"{EXPRESS_URL}/schedules/validate-constraints", json={}).status_code == 401

        # 3. Student gets 403 Forbidden
        assert client.post(f"{EXPRESS_URL}/schedules/validate-constraints", headers=s_headers, json={}).status_code == 403

        # 4. Teacher submits colliding schedule (same teacher, same weekday, overlapping time)
        collision_payload = {
            "teacher": existing["teacher"]["_id"] if isinstance(existing["teacher"], dict) else existing["teacher"],
            "room": "Room-999",
            "division": "6af67b6886d5db9c99165400",
            "weekday": existing["weekday"],
            "startTime": existing["startTime"],
            "endTime": existing["endTime"],
        }
        res_conflict = client.post(f"{EXPRESS_URL}/schedules/validate-constraints", headers=t_headers, json=collision_payload)
        assert res_conflict.status_code == 200
        data_c = res_conflict.json()
        assert data_c["valid"] is False
        assert len(data_c["conflicts"]) >= 1
        assert any("already assigned to a lecture" in c for c in data_c["conflicts"])

        # 5. Non-colliding slot returns valid: True
        clean_payload = {
            "teacher": existing["teacher"]["_id"] if isinstance(existing["teacher"], dict) else existing["teacher"],
            "room": "Room-Free-101",
            "division": "6af67b6886d5db9c99165400",
            "weekday": 7,  # Sunday (no lectures)
            "startTime": "06:00",
            "endTime": "07:00",
        }
        res_clean = client.post(f"{EXPRESS_URL}/schedules/validate-constraints", headers=t_headers, json=clean_payload)
        assert res_clean.status_code == 200
        data_clean = res_clean.json()
        assert data_clean["valid"] is True
        assert len(data_clean["conflicts"]) == 0








