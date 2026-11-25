import path from 'node:path';
import { chromium } from 'playwright';
import { API_URL, APP_URL, RAW_DIR, SCENES_DIR, VIEWPORT } from '../lib/constants.mjs';
import {
  convertWebmToMp4,
  ensureDir,
  hold,
  installCursor,
  loginViaUI,
  logoutViaUI,
  probeDuration,
  runMongoQuery,
  saveCheckpoint,
  showOverlay,
  showTitleCard,
  smoothClick,
} from '../lib/helpers.mjs';

export async function recordScene({ scene, noTitles = false, headless = false }) {
  // Dependency check: requires Scene 2's Third Year C + Prof. Meera Iyer + today's lecture
  const dep = JSON.parse(runMongoQuery(`
    const div = await db.collection('divisions').findOne({ code: 'TE-C' });
    const teacher = await db.collection('users').findOne({ email: 'meera.iyer@university.edu' }, { projection: { _id: 1 } });
    const lec = div ? await db.collection('lectures').findOne({ division: div._id }) : null;
    console.log(JSON.stringify({
      hasDiv: Boolean(div),
      divId: div ? String(div._id) : null,
      hasTeacher: Boolean(teacher),
      lecId: lec ? String(lec._id) : null,
    }));
  `));
  if (!dep.hasDiv || !dep.hasTeacher || !dep.lecId) {
    throw new Error('Scene 4 dependency missing: run Scene 2 first to create Third Year C, Prof. Meera Iyer, and today\'s lecture.');
  }

  ensureDir(RAW_DIR);
  ensureDir(SCENES_DIR);
  const checkpoints = [];

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    acceptDownloads: true,
    recordVideo: { dir: RAW_DIR, size: VIEWPORT },
  });
  await installCursor(context);

  const page = await context.newPage();
  const video = page.video();

  // 1. Title card
  await showTitleCard(page, {
    number: scene.id,
    title: 'Teacher Dashboard & Attendance',
    subtitle: 'At-Risk Analytics, One-Click Attendance on Third Year C, PDF Roster Export & Focus List',
    durationMs: 2500,
    enabled: !noTitles,
  });

  // 2. Tour seeded teacher dashboard (Prof. Adrian Miller) for rich at-risk students & engagement heatmap
  await loginViaUI(page, APP_URL, 'prof.adrian@university.edu', 'Teacher123');
  await hold(page, 2200);
  await page.evaluate(() => window.scrollTo({ top: 380, behavior: 'smooth' }));
  await hold(page, 1800);
  checkpoints.push(await saveCheckpoint(page, 's04-01-teacher-dashboard'));
  await page.evaluate(() => window.scrollTo({ top: 0 }));
  await logoutViaUI(page);

  // 3. Log in as Prof. Meera Iyer (new Third Year C teacher) and open today's lecture
  await loginViaUI(page, APP_URL, 'meera.iyer@university.edu', 'Password123');
  await page.goto(`${APP_URL}/attendance/mark?lectureId=${dep.lecId}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Mark All Present/i }).waitFor({ state: 'visible', timeout: 15000 });
  await hold(page, 1400);

  // One-click Mark All Present, then toggle one student absent
  await smoothClick(page, page.getByRole('button', { name: /Mark All Present/i }), { holdAfterMs: 1200 });
  const absentBtn = page.getByRole('button', { name: /^Absent$/i }).first();
  if (await absentBtn.isVisible().catch(() => false)) {
    await smoothClick(page, absentBtn, { holdAfterMs: 1000 });
  }
  checkpoints.push(await saveCheckpoint(page, 's04-02-attendance-mark'));

  // Export PDF roster from the lecture page
  const dlPromise = page.waitForEvent('download', { timeout: 10000 }).catch(() => null);
  await smoothClick(page, page.getByRole('button', { name: /^PDF$/i }).first(), { holdAfterMs: 1200 });
  const dl = await dlPromise;
  const pdfFileName = dl ? dl.suggestedFilename() : 'roster.pdf';

  // Save attendance
  const saveBtn = page.getByRole('button', { name: /Save|Submit Attendance/i }).first();
  await smoothClick(page, saveBtn, { holdAfterMs: 1800 });

  // 4. Show real captured Focus List API response + PDF export confirmation
  const loginRes = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'prof.adrian@university.edu', password: 'Teacher123' }),
  });
  const { token } = await loginRes.json();
  const focusRes = await fetch(`${API_URL}/attendance/focus-list`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const focusJson = await focusRes.json();

  await showOverlay(page, {
    badge: 'API',
    title: 'Early-Warning Focus List & PDF Roster Export',
    subtitle: `Exported PDF: ${pdfFileName} · GET /api/attendance/focus-list -> HTTP ${focusRes.status}`,
    content: JSON.stringify(
      {
        pdfExported: pdfFileName,
        focusListStatus: focusRes.status,
        atRiskStudentsCount: (focusJson.students || focusJson.focusList || []).length,
        topAtRisk: (focusJson.students || focusJson.focusList || []).slice(0, 6),
      },
      null,
      2,
    ),
    durationMs: 3200,
  });
  checkpoints.push(await saveCheckpoint(page, 's04-03-focus-list-api'));

  await context.close();
  await browser.close();

  const webmPath = await video.path();
  const mp4Path = path.join(SCENES_DIR, `${scene.slug}.mp4`);
  convertWebmToMp4(webmPath, mp4Path);
  const dur = probeDuration(mp4Path);
  console.log(`✅ Scene 04 recorded: ${mp4Path} (${dur.toFixed(2)}s)`);
  console.log(`   Checkpoints: ${checkpoints.join(', ')}`);
  return mp4Path;
}
