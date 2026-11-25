import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { AI_URL, API_URL, APP_URL, OUT_DIR, RAW_DIR, SCENES_DIR, VIEWPORT } from '../lib/constants.mjs';
import {
  assertNoRawSecrets,
  convertWebmToMp4,
  ensureDir,
  hold,
  installCursor,
  loginViaUI,
  openMongoExpress,
  probeDuration,
  runMongoQuery,
  sanitizeOverlayText,
  saveCheckpoint,
  showOverlay,
  showTitleCard,
  smoothClick,
} from '../lib/helpers.mjs';

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function recordScene({ scene, noTitles = false, headless = false }) {
  ensureDir(RAW_DIR);
  ensureDir(SCENES_DIR);
  const checkpoints = [];

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    recordVideo: { dir: RAW_DIR, size: VIEWPORT },
  });
  await installCursor(context);

  const page = await context.newPage();
  const video = page.video();

  // 1. Title card
  await showTitleCard(page, {
    number: scene.id,
    title: 'Student Portal, Anti-Cheat Quiz & Ask My Notes',
    subtitle: 'Attendance Alert, Recovery Plan, Multimodal Notice OCR, Anti-Cheat Proof & Keyword (TF-IDF) Retrieval',
    durationMs: 2500,
    enabled: !noTitles,
  });

  // 2. Log in as Aarav Sharma (seeded TE-A student) -> Dashboard with attendance alert
  await loginViaUI(page, APP_URL, 'aarav.sharma@university.edu', 'Student123');
  await hold(page, 2200);
  checkpoints.push(await saveCheckpoint(page, 's07-01-student-dashboard'));

  // Authenticate via API for API-only student intelligence checks (recovery plan, notice OCR, RAG)
  const loginRes = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'aarav.sharma@university.edu', password: 'Student123' }),
  });
  const { token: studentToken } = await loginRes.json();

  // 3. Recovery plan (GET /api/attendance/recovery-plan)
  const recRes = await fetch(`${API_URL}/attendance/recovery-plan`, {
    headers: { Authorization: `Bearer ${studentToken}` },
  });
  const recJson = await recRes.json();
  await showOverlay(page, {
    badge: 'API',
    title: 'Attendance Recovery Plan (Formula-Backed)',
    subtitle: 'GET /api/attendance/recovery-plan · max(0, 3 * total - 4 * attended) to reach 75%',
    content: JSON.stringify({ status: recRes.status, recoveryPlan: recJson }, null, 2),
    durationMs: 3000,
  });

  // 4. Multimodal Notice Upload in the Student Dashboard UI (Upload -> Extract -> Review -> Save)
  await page.goto(`${APP_URL}/dashboard`, { waitUntil: 'networkidle' });
  await hold(page, 1000);
  const uploadCard = page.locator('section:has(h2:has-text("Upload notice"))');
  await uploadCard.scrollIntoViewIfNeeded();
  await hold(page, 800);

  const noticePath = path.join(OUT_DIR, 'sample-notice.png');
  const fileInput = page.locator('input[type="file"][aria-label="Choose notice file"]');
  await fileInput.setInputFiles(noticePath);
  await hold(page, 1400);

  const extractBtn = page.getByRole('button', { name: /Extract deadline/i });
  await smoothClick(page, extractBtn, { holdAfterMs: 600 });

  const saveBtn = page.getByRole('button', { name: /Save deadline/i });
  await saveBtn.waitFor({ state: 'visible', timeout: 30000 });
  await uploadCard.scrollIntoViewIfNeeded();
  await hold(page, 2200);
  checkpoints.push(await saveCheckpoint(page, 's07-02-notice-ocr'));

  await smoothClick(page, saveBtn, { holdAfterMs: 1200 });
  await page.getByText(/Deadline saved/i).waitFor({ state: 'visible', timeout: 10000 });
  const upcomingCard = page.locator('.card:has(h2:has-text("Upcoming Deadlines"))');
  await upcomingCard.scrollIntoViewIfNeeded();
  await hold(page, 2200);
  checkpoints.push(await saveCheckpoint(page, 's07-02b-notice-saved-badge'));

  // Switch to mongo-express to verify the persisted PersonalDeadline document ("from notice")
  await openMongoExpress(page, 'personaldeadlines');
  await hold(page, 2200);
  checkpoints.push(await saveCheckpoint(page, 's07-02c-mongo-personaldeadlines'));

  // 5. Timed Anti-Cheat Quiz in UI (/student/quizzes)
  await page.goto(`${APP_URL}/student/quizzes`, { waitUntil: 'networkidle' });
  await hold(page, 1800);

  // Fetch student quiz JSON directly to capture real anti-cheat scrubbed payload (no isCorrect)
  const qListRes = await fetch(`${API_URL}/student/quizzes`, {
    headers: { Authorization: `Bearer ${studentToken}` },
  });
  const qListJson = await qListRes.json();
  const targetQuiz = (qListJson.quizzes || [])[0];
  let studentQuizPayload = null;
  let mongoQuizDoc = null;

  if (targetQuiz) {
    const qDetailRes = await fetch(`${API_URL}/student/quizzes/${targetQuiz._id}`, {
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    studentQuizPayload = await qDetailRes.json();

    mongoQuizDoc = JSON.parse(runMongoQuery(`
      const { ObjectId } = require('mongoose').Types;
      const doc = await db.collection('quizzes').findOne({ _id: new ObjectId('${targetQuiz._id}') });
      console.log(JSON.stringify(doc ? { _id: String(doc._id), title: doc.title, firstQuestion: doc.questions?.[0] } : null));
    `));
  }

  // Click into a quiz in UI if Start / Take button is available
  const startQuizBtn = page.getByRole('button', { name: /Start Quiz|Take Quiz|Continue|View/i }).first();
  if (await startQuizBtn.isVisible().catch(() => false)) {
    await smoothClick(page, startQuizBtn, { holdAfterMs: 1400 });
    const beginBtn = page.getByRole('button', { name: /Start Quiz|Begin/i }).first();
    if (await beginBtn.isVisible().catch(() => false)) {
      await smoothClick(page, beginBtn, { holdAfterMs: 1400 });
      // Select first radio/option if on quiz play screen
      const optBtn = page.locator('input[type="radio"], button[data-option]').first();
      if (await optBtn.isVisible().catch(() => false)) {
        await smoothClick(page, optBtn, { holdAfterMs: 1000 });
      }
    }
  }
  checkpoints.push(await saveCheckpoint(page, 's07-03-quiz-ui'));

  // 6. Split View: Browser JSON (NO isCorrect) vs MongoDB Document (WITH isCorrect)
  const leftJson = sanitizeOverlayText(JSON.stringify({
    source: 'Student Browser Response (GET /api/student/quizzes/:id)',
    contains_isCorrect: JSON.stringify(studentQuizPayload || {}).includes('isCorrect'),
    firstQuestion: studentQuizPayload?.quiz?.questions?.[0] ?? studentQuizPayload?.questions?.[0] ?? null,
  }, null, 2));
  const rightJson = sanitizeOverlayText(JSON.stringify({
    source: 'MongoDB yantra_demo.quizzes Document (Server-Side)',
    contains_isCorrect: JSON.stringify(mongoQuizDoc || {}).includes('isCorrect'),
    firstQuestion: mongoQuizDoc?.firstQuestion ?? null,
  }, null, 2));
  assertNoRawSecrets(leftJson + '\n' + rightJson, 'Scene 7 anti-cheat split view');

  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { width: 1920px; height: 1080px; background: #0b1120; color: #f8fafc; font-family: -apple-system, Inter, sans-serif; padding: 48px 56px; display: flex; flex-direction: column; gap: 20px; }
    h1 { font-size: 36px; font-weight: 800; }
    .sub { color: #94a3b8; font-size: 19px; }
    .grid { flex: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 28px; min-height: 0; }
    .pane { background: #0f172a; border: 2px solid #1e293b; border-radius: 14px; padding: 24px; display: flex; flex-direction: column; gap: 14px; overflow: hidden; }
    .pane.left { border-color: #16a34a; }
    .pane.right { border-color: #d97706; }
    .pill { display: inline-block; padding: 6px 14px; border-radius: 999px; font-size: 15px; font-weight: 800; align-self: flex-start; }
    .left .pill { background: rgba(22,163,74,0.2); color: #4ade80; }
    .right .pill { background: rgba(217,119,6,0.2); color: #fbbf24; }
    pre { font-family: "SF Mono", Menlo, monospace; font-size: 16px; line-height: 1.5; color: #e2e8f0; white-space: pre-wrap; }
  </style></head><body>
    <h1>Anti-Cheat Quiz Proof — Server-Side Answer Scrubbing</h1>
    <div class="sub">Side-by-side comparison of live student payload vs. MongoDB source document</div>
    <div class="grid">
      <div class="pane left"><span class="pill">STUDENT BROWSER · isCorrect STRIPPED</span><pre>${escapeHtml(leftJson)}</pre></div>
      <div class="pane right"><span class="pill">MONGODB yantra_demo.quizzes · isCorrect PRESENT</span><pre>${escapeHtml(rightJson)}</pre></div>
    </div>
  </body></html>`, { waitUntil: 'load' });
  await hold(page, 3800);
  checkpoints.push(await saveCheckpoint(page, 's07-04-anticheat-split'));

  // Brief mongo-express view of quizzes collection
  await openMongoExpress(page, 'quizzes');
  await hold(page, 1800);

  // 7. Ask My Notes (Keyword / TF-IDF retrieval with exact citation)
  const ragRes = await fetch(`${AI_URL}/rag/ask-notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${studentToken}` },
    body: JSON.stringify({ query: 'What is deadlock prevention and Coffman conditions in operating systems?' }),
  });
  const ragJson = await ragRes.json();

  await showOverlay(page, {
    badge: 'API',
    title: 'Ask My Notes — Keyword (TF-IDF) Retrieval with Citations',
    subtitle: 'POST /python-app/rag/ask-notes · Deterministic lexical retrieval (no external embedding model)',
    content: JSON.stringify({ status: ragRes.status, query: 'What is deadlock prevention and Coffman conditions in operating systems?', response: ragJson }, null, 2),
    durationMs: 3600,
  });
  checkpoints.push(await saveCheckpoint(page, 's07-05-ask-my-notes'));

  await context.close();
  await browser.close();

  const webmPath = await video.path();
  const mp4Path = path.join(SCENES_DIR, `${scene.slug}.mp4`);
  convertWebmToMp4(webmPath, mp4Path);
  const dur = probeDuration(mp4Path);
  console.log(`✅ Scene 07 recorded: ${mp4Path} (${dur.toFixed(2)}s)`);
  console.log(`   Checkpoints: ${checkpoints.join(', ')}`);
  return mp4Path;
}
