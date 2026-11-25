"""Application configuration loaded from environment / .env."""

from __future__ import annotations

import os
from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Strongly-typed settings. Reads from `.env` and process env vars."""

    model_config = SettingsConfigDict(
        env_file=os.getenv("ENV_FILE", ".env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # --- Server ----------------------------------------------------------
    host: str = Field(default="0.0.0.0", alias="HOST")
    port: int = Field(default=8000, alias="PORT")
    environment: Literal["development", "staging", "production"] = Field(
        default="development",
        alias="ENVIRONMENT",
    )
    cors_origins: str = Field(
        default="http://localhost:5173",
        alias="CORS_ORIGINS",
    )
    institution_timezone: str = Field(
        default="Asia/Kolkata",
        alias="INSTITUTION_TIMEZONE",
        description="IANA timezone used when academic notices omit an explicit timezone.",
    )

    # --- Logging ---------------------------------------------------------
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = Field(
        default="INFO",
        alias="LOG_LEVEL",
    )
    log_json: bool = Field(default=False, alias="LOG_JSON")

    # --- Auth bridge -----------------------------------------------------
    jwt_secret: str = Field(
        default="",
        alias="JWT_SECRET",
        description="Same secret as the Node backend (used when HS256)",
    )
    jwt_algorithm: Literal["HS256", "RS256", "HS384", "HS512"] = Field(
        default="HS256",
        alias="JWT_ALGORITHM",
    )
    jwt_public_key: str | None = Field(
        default=None,
        alias="JWT_PUBLIC_KEY",
        description="RSA public key (PEM string or read from key file) for RS256 verification",
    )

    def get_jwt_public_key(self) -> str:
        """Returns the RSA public key for RS256 asymmetric verification."""
        if self.jwt_public_key:
            return self.jwt_public_key
        # Check standard key paths
        candidates = [
            Path(os.getcwd()) / "keys" / "jwtRS256.key.pub",
            Path(os.getcwd()).parent / "keys" / "jwtRS256.key.pub",
        ]
        for c in candidates:
            if c.is_file():
                return c.read_text(encoding="utf-8")
        return ""

    # --- Node backend ----------------------------------------------------
    node_api_url: str = Field(
        default="http://localhost:3000/api",
        alias="NODE_API_URL",
    )

    # --- Tool Approval Guard --------------------------------------------
    require_tool_approval: bool = Field(
        default=False,
        alias="REQUIRE_TOOL_APPROVAL",
        description="When True, write/bulk tools require explicit PermissionCard approval",
    )

    # --- Public exports --------------------------------------------------
    # Where on-disk export files (PDFs the agent produced) live, and the
    # base URL that maps to that directory via FastAPI's StaticFiles mount.
    exports_dir: str = Field(default="exports", alias="EXPORTS_DIR")
    public_base_url: str = Field(
        default="http://localhost:8000/python-app",
        alias="PUBLIC_BASE_URL",
        description="External base URL (including /python-app prefix) the agent uses when linking to /exports/*.",
    )

    # --- Proxy & Rate Limiting --------------------------------------------
    proxy_headers: bool = Field(default=True, alias="PROXY_HEADERS")
    forwarded_allow_ips: str = Field(default="*", alias="FORWARDED_ALLOW_IPS")
    rate_limit_enabled: bool = Field(default=True, alias="RATE_LIMIT_ENABLED")
    chat_rate_limit: str = Field(default="30/minute", alias="CHAT_RATE_LIMIT")

    # --- Google Gemini ---------------------------------------------------
    gemini_api_key: str = Field(default="", alias="GEMINI_API_KEY")
    gemini_models: str = Field(
        default="gemini-3.6-flash,gemini-2.5-flash",
        alias="GEMINI_MODELS",
        description="Comma-separated ordered list of Gemini models to use (primary first, followed by fallbacks).",
    )
    gemini_model: str = Field(
        default="gemini-3.6-flash",
        alias="GEMINI_MODEL",
        description="Primary Gemini model. Defaults to gemini-3.6-flash.",
    )
    gemini_max_output_tokens: int = Field(
        default=4096,
        alias="GEMINI_MAX_OUTPUT_TOKENS",
    )
    gemini_temperature: float = Field(
        default=0.1,
        alias="GEMINI_TEMPERATURE",
    )

    @property
    def gemini_model_list(self) -> list[str]:
        models = [m.strip() for m in self.gemini_models.split(",") if m.strip()]
        if self.gemini_model and self.gemini_model not in models:
            return [self.gemini_model] + models
        return models or ["gemini-3.6-flash", "gemini-2.5-flash"]

    # --- MCP -------------------------------------------------------------
    mcp_servers: str = Field(default="", alias="MCP_SERVERS")

    # --- WhatsApp (n8n webhook bridge) -----------------------------------
    whatsapp_webhook_url: str = Field(
        default="",
        alias="WHATSAPP_WEBHOOK_URL",
        description="n8n webhook that relays {to, message} to WhatsApp.",
    )
    whatsapp_default_to: str = Field(
        default="whatsapp:+1234567890",
        alias="WHATSAPP_DEFAULT_TO",
        description="Single recipient for the demo — every send_whatsapp_message call uses this.",
    )

    # --- Vapi (outbound voice calls) -------------------------------------
    vapi_base_url: str = Field(
        default="https://api.vapi.ai",
        alias="VAPI_BASE_URL",
    )
    vapi_api_key: str = Field(
        default="",
        alias="VAPI_API_KEY",
        description="Vapi private API key — used as Bearer auth on POST /call.",
    )
    vapi_assistant_id: str = Field(
        default="",
        alias="VAPI_ASSISTANT_ID",
        description="Pre-configured Vapi assistant that handles the call script.",
    )
    vapi_phone_number_id: str = Field(
        default="",
        alias="VAPI_PHONE_NUMBER_ID",
        description="Vapi-managed phone number to dial OUT from.",
    )
    vapi_default_to: str = Field(
        default="+1234567890",
        alias="VAPI_DEFAULT_TO",
        description="E.164 number to dial — same as WhatsApp demo recipient, sans the `whatsapp:` prefix.",
    )

    @field_validator("cors_origins")
    @classmethod
    def _strip_origins(cls, v: str) -> str:
        return ",".join(o.strip() for o in v.split(",") if o.strip())

    @property
    def cors_origin_list(self) -> list[str]:
        return [o for o in self.cors_origins.split(",") if o]

    @property
    def is_production(self) -> bool:
        return self.environment == "production"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Cached settings accessor. Call this from FastAPI deps / startup code."""
    return Settings()