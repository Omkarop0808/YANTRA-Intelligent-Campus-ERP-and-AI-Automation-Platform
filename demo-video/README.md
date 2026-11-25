# Yantra ERP — Silent Demo Walkthrough Recorder (`demo-video/`)

Automated Playwright + `ffmpeg` recorder that produces a 1920x1080 30fps H.264 silent walkthrough video (`out/full.mp4`), per-scene clips (`out/scenes/NN-*.mp4`), checkpoint screenshots (`out/checkpoints/`), and exact timing metadata (`out/timeline.json`).

---

## Recording Environment & Isolation
* Uses an isolated MongoDB database named **`yantra_demo`** via `MONGODB_URI` overrides at process start — never touches your dev `.env` files.
* Uses [demo-video/.env.recording](./.env.recording) with higher rate limits (`RATE_LIMIT_LOGIN_MAX=1000`, `RATE_LIMIT_WRITE_MAX=1000`, `CHAT_RATE_LIMIT=1000/minute`) so Scene 2 setup does not trigger HTTP 429, plus `WHATSAPP_DRY_RUN=true` and `VAPI_DRY_RUN=true` so zero external messages or calls are dispatched.
* Runs a read-only `mongo-express` container (`ME_CONFIG_OPTIONS_READONLY=true`) bound to `127.0.0.1:8081` via Docker Compose profile `demo`.

---

## Quick Usage

```bash
# 1. Reset yantra_demo to a clean base state (no "Third Year C") and start all services
bash demo-video/prepare.sh

# 2. List all scenes
cd demo-video && node record.mjs --list

# 3. Record a single scene
node record.mjs --scene 2

# 4. Record all scenes and concatenate into out/full.mp4 + out/timeline.json
node record.mjs --all
```

### Resetting for Scene 2 Re-Recording
Scene 2 requires `"Third Year C"` (`TE-C`) to not exist yet. To re-record Scene 2 from a clean slate, run:
```bash
bash demo-video/prepare.sh
```

---

## Model Notes (Measured Live During Recording)

Probed against the provided Gemini API key on **2026-11-24 at 14:15–14:20 IST** (without modifying app defaults):

| Model ID | Observed Status | Timestamp (IST) | Notes |
| :--- | :--- | :--- | :--- |
| **`gemini-flash-lite-latest`** | **200 OK (Plain Chat & Multimodal OCR) / 400 INVALID_ARGUMENT (Tool Calling)** | 2026-11-24 14:19 & 14:49 | Works for plain prompts & Notice OCR (`1.0` confidence in Scene 7), but rejects LangChain multi-tool schema binding with `400 INVALID_ARGUMENT`. |
| **`gemini-3.1-flash-lite`** | **200 OK → 503 UNAVAILABLE / timeout** | 2026-11-24 14:36 & 14:45 | Worked as fallback at 14:36; experienced 503 high-demand spikes at 14:41–14:45. |
| **`gemini-3-flash-preview`** | **200 OK → 429 RESOURCE_EXHAUSTED (20 RPD cap)** | 2026-11-24 14:19 & 14:35 | Worked for preflight, multimodal notice OCR (1.0 confidence), and initial Scene 5 `create_quiz` PermissionCard before hitting Free Tier 20 requests/day limit. |
| `gemini-3.6-flash` | **503 UNAVAILABLE / 504 DEADLINE_EXCEEDED** | 2026-11-24 14:15 & 14:19 | Listed in `models.list()` (65 available), but experienced temporary high-demand 503/504 spikes during recording. |
| `gemini-flash-latest` | **504 DEADLINE_EXCEEDED** | 2026-11-24 14:19 | Timed out under 15s deadline during probe. |
| `gemini-2.5-flash` | **404 Not Found** | 2026-11-24 14:15 | Listed in `models.list()`, but returned `HTTP 404 Not Found` on `v1beta/models/gemini-2.5-flash:generateContent`. |
