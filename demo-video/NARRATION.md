# Yantra ERP — Silent Demo Walkthrough Narration Script (`NARRATION.md`)

> Voiceover draft timed to `demo-video/out/timeline.json` (~130 words per minute). Every line describes only what is visibly on screen.
>
> **Total recorded duration (14 scenes: 01–04, 05, 5b, 06–07, 7b, 08–12)**: **444.53s (7m 25s)** — `demo-video/out/full.mp4`

---

## Scene 01 — Title & Architecture (`0:00 – 0:11`, `10.77s`)
* **On-screen**: Title card, then full-screen `yantra_architecture_excalidraw_light.png` (React/Vite frontend, Express/MongoDB core ERP, FastAPI/LangGraph AI agent, read-only `mongo-express`).
* **Draft voiceover**:
  > "Welcome to Yantra ERP—an academic operations platform combining a React frontend, an Express and MongoDB core backend, and a FastAPI LangGraph AI service with human-in-the-loop approvals."

---

## Scene 02 — Database & Setup From Scratch (`0:11 – 2:33`, `141.83s`)
* **On-screen**: Read-only `mongo-express` on `yantra_demo` (collection counts + `attendances` compound index), Admin creating `Third Year C` (`TE-C`) and subjects `CS-311`, `CS-312`, `CS-313` in `/admin/academic-setup`, `Prof. Meera Iyer` registering at `/signup` and approved in `/admin`, 5 students registered (`1` via `/signup` UI + `4` via `POST /api/auth/register/student` **`API` overlay** + `GET /api/academic/divisions/:id/students`), weekly timetable slots in `/attendance/schedules` + `POST /api/schedules/materialise` (**`API` overlay**), and before/after collection-count diff table.
* **Draft voiceover**:
  > "Starting from a clean isolated `yantra_demo` database, we inspect the collections and attendance compound index in read-only mongo-express. In the Academic Setup console, the admin creates a new class, Third Year C, and three subjects: CS-311 Data Structures, CS-312 Operating Systems, and CS-313 Database Management. Next, Prof. Meera Iyer signs up and is approved by the admin, automatically linking her division and subject references. We enroll five students—one through the signup form and four via the registration API—and verify the division roster returns all five. Prof. Iyer adds weekly timetable slots, materialises today's CS-311 lecture, and our before-and-after table confirms every collection count updated in MongoDB."

---

## Scene 03 — Admin Overview & Audit Trail (`2:33 – 2:53`, `20.83s`)
* **On-screen**: Admin dashboard (3 divisions, 7 subjects, 4 teachers), `/admin` pending approvals & audit log, logout.
* **Draft voiceover**:
  > "On the Admin Dashboard, the new class, subjects, and faculty member appear immediately in live counts alongside the governance audit view."

---

## Scene 04 — Teacher Workspace & One-Click Attendance (`2:53 – 3:31`, `37.27s`)
* **On-screen**: Seeded teacher dashboard (`prof.adrian`), `Prof. Meera Iyer` opening today's `CS-311` lecture for `Third Year C` (5 students), one-click attendance marking, PDF roster export, and `GET /api/attendance/focus-list` (**`API` overlay**).
* **Draft voiceover**:
  > "In the faculty workspace, teachers review attendance trends and at-risk alerts. Switching to Prof. Meera Iyer, she opens today's CS-311 lecture for Third Year C, marks all five students in one click, exports the PDF attendance sheet, and queries the Focus List API to prioritize students needing follow-up."

---

## Scene 05 — Autonomous AI Agent & Human-in-the-Loop Approvals (`3:31 – 4:08`, `37.50s`)
* **On-screen**: Highlight clip powered by `gemini-3-flash-preview` — `Prof. Meera Iyer` prompts the Chat Interface (`"Create a 5-question multiple-choice quiz on binary search trees for Third Year C, subject CS-311 Data Structures, 2 marks each, 10 minutes."`), the 3-step Automation Pipeline resolves `Third Year C` and `CS-311`, pauses on the live **`PermissionCard`** (`Approval requested for action: create_quiz`, `Allow` + `Submit`), followed by the WhatsApp defaulter reminder **`DEMO MODE`** overlay (`WHATSAPP_DRY_RUN=true`, `VAPI_DRY_RUN=true`, nothing sent externally).
* **Draft voiceover**:
  > "In the Chat Interface powered by Gemini 3 Flash Preview, Prof. Iyer asks the agent to create a five-question multiple-choice quiz on binary search trees for Third Year C. The automation pipeline resolves the class and subject, then pauses on a PermissionCard requiring explicit approval before executing `create_quiz`. External WhatsApp defaulter reminders run in dry-run Demo Mode so nothing is sent externally."

---

## Scene 05b — Deterministic Macro Recorder & Idempotent Alert Engine (`3:31 – 4:13`, `42.20s`)
* **On-screen**:
  1. **DOM Macro Recorder & Replay (UI)**: `Prof. Meera Iyer` in `/automation` clicks **New Automation**, records `"TE-C Attendance Check"` with the floating `RECORDING` overlay on `/attendance`, clicks **Save**, then clicks **Run** to replay it (`Ran "TE-C Attendance Check" successfully`).
  2. **Idempotent Alert Engine (`API · DEMO MODE` overlay + Student UI + `mongo-express`)**: Triggered twice through the API (`POST /api/alerts/run`) with WhatsApp in dry-run **DEMO MODE** (`WHATSAPP_DRY_RUN=true`, `ENABLE_ALERT_WHATSAPP=false`). Run 1 generates `13` low-attendance alerts (`skipped: 0`, MongoDB `notifications`: `100 → 113`); Run 2 generates `0` (`skipped: 13`, MongoDB `notifications`: `113 → 113`, zero duplicates via unique `dedupeKey`). Student `Aarav Sharma` opens the Notification Bell in the UI, followed by read-only `mongo-express` `notifications`.
  3. *(Recovery plan skipped here because `GET /api/attendance/recovery-plan` has no dedicated student UI — shown through the API in Scene 07.)*
* **Draft voiceover**:
  > "Beyond conversational AI, Yantra includes a deterministic DOM macro recorder. In the Automation console, Prof. Iyer starts a new recording, navigates through attendance while the floating overlay captures each step, saves the macro, and replays it on demand. Next, we trigger the idempotent alert engine twice through the API in dry-run Demo Mode: the first run generates thirteen low-attendance notifications in MongoDB, and the second run skips all thirteen via unique dedupe keys—creating zero duplicates. Students see those warnings in their notification bell, backed by the `notifications` collection."

---

## Scene 06 — AI-Assisted Batch Grading (`4:13 – 4:35`, `22.07s`)
* **On-screen**: `Prof. Adrian Miller` in Grade Batch → AI Grading Review → approving and publishing 10/10 proposed rubric grades.
* **Draft voiceover**:
  > "In Grade Batch, Prof. Adrian Miller reviews AI-proposed rubric scores and similarity check signals across student submissions, approving and publishing all ten grades with human oversight."

---

## Scene 07 — Student Portal, Upload Notice UI, Anti-Cheat Quiz & Ask My Notes (`5:27 – 6:19`, `51.60s`)
* **On-screen**:
  1. Student Dashboard (`Aarav Sharma`, `TE-A-001`) with live attendance progress and `< 75%` Attendance Alert banner.
  2. `GET /api/attendance/recovery-plan` (**`API` overlay**): formula-backed lectures needed (`max(0, 3 * total - 4 * attended)`) to reach 75%.
  3. Native **Upload notice** card on the Student Dashboard: upload `sample-notice.png` → click **Extract deadline** (`POST /python-app/ingest/document` with `gemini-3-flash-preview`) → review form pre-filled with `CS-301 Data Structures & Algorithms`, `Binary Search Tree Lab Assignment Submission`, `Assignment`, and **`15/12/2026, 11:59 PM`** (`100% match`, institution-local `Asia/Kolkata` time) → click **Save deadline** (`POST /api/deadlines/personal`) → new deadline appears immediately at the top of **Upcoming Deadlines** (`15 Dec`) with the green **`from notice`** badge without a page reload → `mongo-express` `personaldeadlines` showing the stored document (`deadline: Tue Dec 15 2026 18:29:00 GMT+0000`, `source: from notice`).
  4. `/student/quizzes` UI + side-by-side anti-cheat proof (`GET /api/student/quizzes/:id` with `contains_isCorrect: false` vs MongoDB `quizzes` doc with `contains_isCorrect: true`) + `mongo-express` `quizzes`.
  5. `POST /python-app/rag/ask-notes` (**`API` overlay**): keyword (TF-IDF) retrieval (`offline-extractive-v1`) with exact citations from `OS_Unit2_Deadlocks.pdf`.
* **Draft voiceover**:
  > "In the student workspace, Aarav Sharma sees his live attendance progress and an alert where attendance has dipped below seventy-five percent, backed by the recovery-plan API. Right on the dashboard, he uploads an academic notice image into the Upload Notice card and clicks Extract Deadline. Yantra extracts the subject, title, and deadline—showing December 15 at 11:59 PM in local institution time—into an editable review form without saving anything until Aarav confirms. Clicking Save Deadline immediately adds the item to Upcoming Deadlines with a green 'from notice' badge, and mongo-express confirms the UTC-stored PersonalDeadline document. Next, our side-by-side quiz check proves the server strips every `isCorrect` flag before sending questions to the browser. Finally, Ask My Notes runs keyword TF-IDF retrieval over course notes and returns exact file and section citations."

---

## Scene 07b — How Students Recover Attendance to 75% (`6:04 – 6:24`, `19.23s`)
* **On-screen**: Student `Aarav Sharma` opens `/attendance` (showing `73.8%` overall, `3` at-risk subjects below 75%, `1` safe subject), followed by a live visual **Student Attendance Recovery Plan** table fetched through the API (`GET /api/attendance/recovery-plan`, formula `max(0, 3 * total - 4 * attended)`): `CS-304` (`73.3%`, attend next `1` lecture), `CS-302` (`73.3%`, attend next `1` lecture), `CS-301` (`68.8%`, attend next `4` consecutive lectures), `CS-303` (`80%`, eligible).
* **Draft voiceover**:
  > "To see exactly how to recover eligibility, Aarav opens his per-subject attendance breakdown, and the recovery-plan API calculates the exact consecutive lectures needed in each at-risk subject—one each for Machine Learning and Operating Systems, and four consecutive lectures for Data Structures—to cross the seventy-five percent threshold."

---

## Scene 08 — Parent Academic Portal (`6:24 – 6:42`, `18.23s`)
* **On-screen**: `Rajesh Sharma` (`parent.sharma@university.edu`) read-only Parent Academic Portal displaying `Aarav Sharma`'s attendance (`72.1%`, below 75% threshold) and recovery status.
* **Draft voiceover**:
  > "Parents get a dedicated read-only portal scoped strictly to their linked student, surfacing live attendance percentages and recovery status without exposing administrative or write controls."

---

## Scene 09 — Attendance Compliance Export (`5:03 – 5:13`, `10.20s`)
* **On-screen**: Admin `GET /api/reports/attendance-compliance?division=<TE-A>&format=csv|pdf` (**`API` overlay**) + rendered Page 1 of the generated PDFKit compliance report.
* **Draft voiceover**:
  > "Administrators can export division-level attendance compliance audits in both CSV and formatted PDFKit reports ready for institutional review."

---

## Scene 10 — Verification Evidence, Benchmarks & Containers (`5:13 – 5:31`, `17.87s`)
* **On-screen**:
  1. **`TERMINAL` overlay**: Real record-time outputs of the Python offline unit suite (`tests/test_gemini_models.py`, `tests/test_proxy_rate_limit.py`, `tests/test_ingest.py`) and Express `npm test` (9/9 passing).
  2. **`BENCHMARK_RESULTS.JSON` table**: Read directly from `benchmark_results.json` (`Apple M4 · 16 GB RAM · Darwin arm64 · Node v26.9.0 · Python 3.11.17 · commit 1d7a407 · load generator on same machine · relaxed limits via .env.bench`). Shows 1-vs-2 instance Nginx container scaling (`Express Health 0.86x`, `FastAPI Tools Registry 1.15x`, `Student Quizzes 0.93x`, `Attendance Stats Pipeline 1.31x`, `Express Auth Login Bcrypt 1.97x`, `0%` errors) and native C++ libuv `bcrypt` optimization at c=25 (`18.5 RPS / p95 3520.31ms` → `135.4 RPS / p95 220.93ms`, `7.32x` throughput, `15.93x` p95 reduction).
  3. **`TERMINAL` overlay**: Real record-time `docker compose ps` output.
* **Draft voiceover**:
  > "For verification evidence, we run the offline Python unit suite and Express RBAC tests live. Next, our benchmark table—read directly from `benchmark_results.json` on an Apple M4 with 16 gigabytes of RAM, load generator on the same machine, and relaxed limits via `.env.bench`—shows zero-error horizontal scaling across two instances behind Nginx, including 1.31x on the attendance stats pipeline and 1.97x on bcrypt login, while replacing pure-JavaScript bcryptjs with native C++ libuv bcrypt lifted login throughput 7.32x and cut p95 latency 15.93x at concurrency 25. Finally, `docker compose ps` confirms the running container stack."

---

## Scene 11 — Model Context Protocol (MCP) Server (`5:31 – 5:41`, `9.97s`)
* **On-screen**: **`TERMINAL` overlay** capturing a live `mcp.client.stdio` session against `python-backend/mcp_server.py`, listing all 8 exposed tools (`list_divisions`, `list_subjects`, `get_attendance_stats`, `list_quizzes`, `list_upcoming_deadlines`, `get_recovery_plan`, `create_announcement`, `mark_attendance`) and executing the read-only `list_divisions` tool against `yantra_demo` (with tokens redacted).
* **Draft voiceover**:
  > "Yantra also ships a standard Model Context Protocol server over stdio. Connecting with an MCP client lists all eight RBAC-enforced ERP tools and executes a live read-only `list_divisions` call against the demo database."

---

## Scene 12 — Closing Card (`5:41 – 5:46`, `4.77s`)
* **On-screen**: Closing card displaying project name **Yantra** and the six-person team name **Team Karatsuba** (no private repository URL shown).
* **Draft voiceover**:
  > "That is Yantra—built by Team Karatsuba. Thank you for watching."
