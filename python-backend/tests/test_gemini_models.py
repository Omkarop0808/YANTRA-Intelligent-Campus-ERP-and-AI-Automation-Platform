"""Tests for Gemini model deprecation handling, fallback chains, and startup checks."""

from __future__ import annotations

from unittest.mock import MagicMock, patch
import pytest

from app.core.config import Settings
from app.core.model_verifier import verify_gemini_models
from app.agents.erp_agent import _friendly_error


def test_gemini_models_env_config():
    """Verify GEMINI_MODELS ordered parsing and default fallback."""
    # Custom comma-separated list
    s = Settings(
        GEMINI_MODELS="gemini-3.6-flash,gemini-2.5-flash,gemini-custom",
        GEMINI_MODEL="gemini-3.6-flash",
    )
    assert s.gemini_model_list == [
        "gemini-3.6-flash",
        "gemini-2.5-flash",
        "gemini-custom",
    ]

    # Explicit primary model prepended if not first
    s2 = Settings(
        GEMINI_MODELS="gemini-2.5-flash,gemini-custom",
        GEMINI_MODEL="gemini-3.6-flash",
    )
    assert s2.gemini_model_list == [
        "gemini-3.6-flash",
        "gemini-2.5-flash",
        "gemini-custom",
    ]

    # Default fallback
    s_default = Settings()
    assert s_default.gemini_model == "gemini-3.6-flash"
    assert "gemini-3.6-flash" in s_default.gemini_model_list
    assert "gemini-2.5-flash" in s_default.gemini_model_list


def test_verify_gemini_models_startup_no_key():
    """Verify startup check handles missing API key gracefully."""
    s = Settings(GEMINI_API_KEY="")
    result = verify_gemini_models(s)
    assert result["checked"] is False
    assert result["reason"] == "no_api_key"


def test_verify_gemini_models_startup_with_models():
    """Verify startup check detects existing and missing configured models."""
    mock_model_1 = MagicMock()
    mock_model_1.name = "models/gemini-3.6-flash"
    mock_model_2 = MagicMock()
    mock_model_2.name = "models/gemini-other"

    mock_client = MagicMock()
    mock_client.models.list.return_value = [mock_model_1, mock_model_2]

    s = Settings(
        GEMINI_API_KEY="test-key-mock",
        GEMINI_MODELS="gemini-3.6-flash,gemini-2.5-flash",
        GEMINI_MODEL="gemini-3.6-flash",
    )

    with patch("google.genai.Client", return_value=mock_client):
        result = verify_gemini_models(s)
        assert result["checked"] is True
        assert "gemini-3.6-flash" in result["existing"]
        assert "gemini-2.5-flash" in result["missing"]


def test_404_and_not_found_triggers_model_fallback():
    """Verify 404 or model not found triggers fallback condition."""
    from app.agents.erp_agent import run_agent
    from app.core.security import AuthPrincipal

    principal = AuthPrincipal(
        sub="60c72b2f9b1d8b2bad000001",
        role="teacher",
        status="active",
    )

    # 1. Test error pattern detection
    err_404 = Exception("404 models/gemini-2.0-flash is not found for API version v1beta")
    err_deprecated = Exception("models/gemini-2.0-flash is deprecated and shut down")

    # 2. Test _friendly_error message handles 404 / deprecated
    friendly_msg = _friendly_error(err_404)
    assert "GEMINI_MODELS" in friendly_msg

    # 3. Test that run_agent handles model error by attempting fallback
    with patch("app.agents.erp_agent.get_settings") as mock_settings:
        mock_settings.return_value = Settings(
            GEMINI_API_KEY="mock-key",
            GEMINI_MODELS="gemini-3.6-flash,gemini-2.5-flash",
            GEMINI_MODEL="gemini-3.6-flash",
        )
        with patch("app.agents.erp_agent._build_graph", return_value=MagicMock()):
            with patch("app.agents.erp_agent._invoke_turn") as mock_invoke:
                ai_msg = MagicMock()
                ai_msg.type = "ai"
                ai_msg.content = "Fallback succeeded on gemini-2.5-flash"
                ai_msg.tool_calls = []

                # First call fails with 404 model not found, second succeeds
                mock_invoke.side_effect = [
                    Exception("404 Model models/gemini-3.6-flash not found"),
                    [ai_msg],
                ]

                import asyncio
                response = asyncio.run(run_agent(
                    session_id="test-session-fallback",
                    message="Hello",
                    principal=principal,
                    token="test-token",
                ))

                assert "Fallback succeeded" in response.reply
