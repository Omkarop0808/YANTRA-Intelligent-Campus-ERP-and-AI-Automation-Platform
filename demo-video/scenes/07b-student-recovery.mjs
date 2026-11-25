import path from 'node:path';
import { chromium } from 'playwright';
import { API_URL, APP_URL, RAW_DIR, SCENES_DIR, VIEWPORT } from '../lib/constants.mjs';
import {
  assertNoRawSecrets,
  convertWebmToMp4,
  ensureDir,
  hold,
  installCursor,
  loginViaUI,
  probeDuration,
  sanitizeOverlayText,
  saveCheckpoint,
  showTitleCard,
  smoothClick,
} from '../lib/helpers.mjs';

const escapeHtml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function recordScene({ scene, noTitles = false, headless = true }) {
  ensureDir(RAW_DIR);
  ensureDir(SCENES_DIR);
  const checkpoints = [];

  // Fetch live student recovery plan from Express API (zero Gemini calls)
  const loginRes = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'aarav.sharma@university.edu', password: 'Student123' }),
  });
  const { token: studentToken } = await loginRes.json();
  const recRes = await fetch(`${API_URL}/attendance/recovery-plan`, {
    headers: { Authorization: `Bearer ${studentToken}` },
  });
  const recJson = await recRes.json();
  const plan = recJson.recoveryPlan || [];

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    recordVideo: { dir: RAW_DIR, size: VIEWPORT },
  });
  await installCursor(context);

  const page = await context.newPage();
  const video = page.video();

  // 1. Title card (2.0s)
  await showTitleCard(page, {
    number: scene.id,
    title: 'How Students Recover Attendance to 75%',
    subtitle: 'Per-Subject Attendance Breakdown & Formula-Backed Recovery Plan',
    durationMs: 2000,
    enabled: !noTitles,
  });

  // 2. Log in as Aarav Sharma -> open Student Attendance page (/attendance)
  await loginViaUI(page, APP_URL, 'aarav.sharma@university.edu', 'Student123');
  await smoothClick(page, page.getByRole('link', { name: 'Attendance' }).first(), { holdAfterMs: 600 });
  await page.waitForURL('**/attendance**', { timeout: 15000 });
  await hold(page, 2400);
  checkpoints.push(await saveCheckpoint(page, 's07b-01-student-attendance'));

  // 3. Visual Recovery Plan table rendered directly from live GET /api/attendance/recovery-plan
  const rowsHtml = plan
    .map((p) => {
      const isSafe = p.status === 'safe' || p.classesNeeded === 0;
      const action = isSafe
        ? 'Eligible — maintain >= 75%'
        : `Attend next ${p.classesNeeded} consecutive lecture${p.classesNeeded === 1 ? '' : 's'}`;
      return `<tr>
        <td><strong>${escapeHtml(p.code)}</strong> · ${escapeHtml(p.name)}</td>
        <td class="num">${escapeHtml(p.attended)} / ${escapeHtml(p.total)}</td>
        <td class="num ${isSafe ? 'ok' : 'warn'}">${escapeHtml(p.pct)}%</td>
        <td class="num accent">${escapeHtml(p.classesNeeded)}</td>
        <td class="num">${escapeHtml(p.remainingLectures)}</td>
        <td><span class="pill ${isSafe ? 'safe' : 'rec'}">${escapeHtml(action)}</span></td>
      </tr>`;
    })
    .join('');

  const safeCheck = sanitizeOverlayText(JSON.stringify(plan));
  assertNoRawSecrets(safeCheck, 'Scene 7b recovery plan');

  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"><style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { width: 1920px; height: 1080px; background: #0b1120; color: #f8fafc; font-family: -apple-system, Inter, sans-serif; padding: 52px 68px; display: flex; flex-direction: column; gap: 24px; }
      .top { display: flex; align-items: center; gap: 16px; }
      .badge { background: #2563eb; color: #fff; font-weight: 800; padding: 8px 16px; border-radius: 8px; font-size: 16px; letter-spacing: 0.8px; }
      h1 { font-size: 38px; font-weight: 800; }
      .formula { background: #0f172a; border: 1px solid #1e293b; border-left: 5px solid #38bdf8; border-radius: 10px; padding: 16px 22px; color: #cbd5e1; font-size: 19px; font-family: "SF Mono", Menlo, monospace; }
      table { width: 100%; border-collapse: collapse; background: #0f172a; border: 1px solid #1e293b; border-radius: 14px; overflow: hidden; }
      th, td { padding: 20px 22px; text-align: left; border-bottom: 1px solid #1e293b; font-size: 20px; }
      th { background: #1e293b; color: #cbd5e1; font-size: 15px; text-transform: uppercase; letter-spacing: 0.7px; }
      td.num, th.num { text-align: right; font-family: "SF Mono", Menlo, monospace; }
      td.ok { color: #4ade80; font-weight: 800; }
      td.warn { color: #fbbf24; font-weight: 800; }
      td.accent { color: #38bdf8; font-weight: 900; font-size: 24px; }
      .pill { display: inline-block; padding: 6px 14px; border-radius: 999px; font-size: 16px; font-weight: 700; }
      .pill.safe { background: rgba(22, 163, 74, 0.2); color: #4ade80; }
      .pill.rec { background: rgba(245, 158, 11, 0.2); color: #fbbf24; }
    </style></head><body>
      <div class="top"><span class="badge">API</span><h1>Student Attendance Recovery Plan (Aarav Sharma · TE-A-001)</h1></div>
      <div class="formula">GET /api/attendance/recovery-plan · Formula: classesNeeded = max(0, 3 * total - 4 * attended) to reach 75% threshold</div>
      <table>
        <thead>
          <tr>
            <th>Subject</th>
            <th class="num">Attended</th>
            <th class="num">Current %</th>
            <th class="num">Needed</th>
            <th class="num">Remaining</th>
            <th>Action to Restore Eligibility</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </body></html>`,
    { waitUntil: 'load' },
  );
  await hold(page, 4800);
  checkpoints.push(await saveCheckpoint(page, 's07b-02-recovery-plan'));

  await context.close();
  await browser.close();

  const webmPath = await video.path();
  const mp4Path = path.join(SCENES_DIR, `${scene.slug}.mp4`);
  convertWebmToMp4(webmPath, mp4Path);
  const dur = probeDuration(mp4Path);
  console.log(`✅ Scene 7b recorded: ${mp4Path} (${dur.toFixed(2)}s)`);
  console.log(`   Checkpoints: ${checkpoints.join(', ')}`);
  return mp4Path;
}
