# Yantra ERP — 5-Minute Live Pitch & Demonstration Script

**Audience:** Hackathon Judges & Evaluation Panel  
**Time Limit:** 5 Minutes  
**Demonstrators:** Full-Stack Team  
**Prerequisites:** Run `./scripts/demo-reset.sh` before going on stage.

---

## ⏱️ Minute 1: The Vision & Teacher Command Center (0:00 - 1:00)

1. **The Hook:**
   > *"Modern university ERPs are siloed, fragile, and leave teachers overwhelmed with administrative drudgery while students blindly fall below eligibility thresholds. Yantra is India's first AI-native campus operating system with deterministic safety and autonomous action."*

2. **Login as Teacher:**
   - URL: `http://localhost:5173/login`
   - Credentials: `prof.adrian@university.edu` / `Teacher123`
3. **Show Teacher Dashboard:**
   - Highlight Division `TE-A` metrics, timetable slots, and lecture status.
   - Point out the **Automated Schedule Collision Solver**: explain that any double-booked room, conflicting division, or teacher overlap is preemptively blocked via `/api/schedules/validate-constraints`.

---

## ⏱️ Minute 2: Multimodal Notice Document Ingestion (1:00 - 2:00)

1. **Problem Statement:**
   > *"Circulars and assignment deadlines are shared as noisy PDFs and notice board photos. Students miss deadlines because manual calendar entry fails."*

2. **Action: Upload Notice Document:**
   - Navigate to `/chat-interface` or trigger notice upload (`/ingest/document`).
   - Drag and drop an academic circular image/PDF.
   - Show Gemini multimodal OCR extracting:
     - Course: `Database Management Systems`
     - Action: `Submission: Assignment 3 — B-Tree Indexing`
     - Extracted Deadline: `2026-11-28T23:59:59Z`
     - Confidence score: `94%`
3. **Student Sync:**
   - One-click confirmation saves a verified `PersonalDeadline` tagged `"from notice"`.
   - Explain how the background **Alert Engine** deduplicates and produces notifications 24 hours prior to prevent deadline clustering.

---

## ⏱️ Minute 3: Early Warning Focus List & Defaulter Triage (2:00 - 3:00)

1. **Navigate to Analytics & Reports:**
   - Go to `/attendance/analytics` (or `/reports`).
2. **Show Early Warning Focus List:**
   - Highlight the real-time rule-based composite risk score ($0 - 100$).
   - Show how risk combines:
     - **Attendance deficit** (below 75% threshold)
     - **Failed / missed quizzes**
     - **Overdue assignment submissions**
   - Click on student **Aarav Sharma**:
     - Attendance: `62.5%`
     - Risk Tier: `HIGH`
     - Warning Triggers: `Attendance below 75% in TE-A`, `1 low quiz score`.

---

## ⏱️ Minute 4: Recovery Planner & Parent Portal (3:00 - 4:00)

1. **Student View — Attendance Recovery Planner:**
   - Log in as student (`aarav.sharma@university.edu` / `Student123`).
   - Navigate to `/dashboard` & `/attendance`.
   - Point out the **Attendance Recovery Card**:
     - Formula: $\text{Classes Needed} = \max(0, 3 \times \text{total} - 4 \times \text{attended})$.
     - Shows exactly: *"Attend 1 more lecture in CS-301 to restore 75% eligibility."*
     - Shows whether recovery is achievable within the semester's remaining scheduled timetable slots.
2. **Parent Portal Shell:**
   - Log in as parent (`parent.sharma@university.edu` / `Parent123!`).
   - Show read-only student dashboard for Aarav Sharma:
     - Real-time overall percentage, subject-by-subject recovery status, and zero edit access.
     - Mention IDOR security: Parents are strictly isolated to their own registered children.

---

## ⏱️ Minute 5: Conversational AI Agent Approval Card & Compliance Export (4:00 - 5:00)

1. **Human-in-the-Loop Agent Permission Gate:**
   - Switch back to Teacher session on `/chat-interface`.
   - Prompt: *"Mark attendance for all students in TE-A as present"* or *"Broadcast an announcement about tomorrow's lab"*.
   - **Show the PermissionCard:**
     - The AI does **NOT** write silently to the database.
     - An interactive approval card renders: *"Approval required to broadcast announcement / mark attendance"*.
     - Click **Approve**: Action executes cleanly and audit row is written to `AgentAuditLog`.
     - Click **Reject**: Nothing is saved; database state remains immutable.
2. **Official Compliance Export:**
   - Click **Export Attendance Compliance Report** (`/api/reports/attendance-compliance?division=...&format=pdf` or `csv`).
   - Open downloaded PDF/CSV:
     - Official university header, student breakdown, attendance percentages, Defaulter flags (`YES` for $<75\%$), and compliance summary statistics footer.
3. **Closing Remark:**
   > *"Yantra turns static ERP records into an active intelligence loop — from multimodal notice ingestion to actionable recovery plans and audited AI automation."*
