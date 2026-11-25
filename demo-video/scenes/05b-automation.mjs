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
  openMongoExpress,
  probeDuration,
  runMongoQuery,
  saveCheckpoint,
  showOverlay,
  showTitleCard,
  smoothClick,
} from '../lib/helpers.mjs';

export async function recordScene({ scene, noTitles = false, headless = true }) {
  ensureDir(RAW_DIR);
  ensureDir(SCENES_DIR);
  const checkpoints = [];

  // Reset any prior demo macro with the same name & prior alert-engine notifications so counts are clean
  const preCleanup = JSON.parse(runMongoQuery(`
    await db.collection('automations').deleteMany({ name: 'TE-C Attendance Check' });
    await db.collection('notifications').deleteMany({ dedupeKey: { $regex: '^alert:' } });
    const notifBefore = await db.collection('notifications').countDocuments();
    const alertBefore = await db.collection('notifications').countDocuments({ dedupeKey: { $regex: '^alert:' } });
    console.log(JSON.stringify({ notifBefore, alertBefore }));
  `));

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
    title: 'Deterministic Automation & Idempotent Alerts',
    subtitle: 'DOM Macro Recorder & Replay · Deduplicated Alert Engine · Dry-Run WhatsApp (DEMO MODE)',
    durationMs: 2000,
    enabled: !noTitles,
  });

  // 2a. Macro Recorder & Replay in UI (Prof. Meera Iyer -> /automation)
  await loginViaUI(page, APP_URL, 'meera.iyer@university.edu', 'Password123');
  await smoothClick(page, page.getByRole('link', { name: 'Automation' }).first(), { holdAfterMs: 500 });
  await page.waitForURL('**/automation', { timeout: 15000 });
  await hold(page, 600);

  // Trigger window.prompt for "New Automation"
  page.once('dialog', async (dialog) => {
    await dialog.accept('TE-C Attendance Check');
  });
  await smoothClick(page, page.getByRole('button', { name: /New Automation/i }).first(), { holdAfterMs: 700 });
  await page.waitForURL('**/attendance**', { timeout: 15000 });
  await hold(page, 600);

  // Record 2 real UI actions while floating RecorderOverlay captures steps
  const studentsLink = page.getByRole('link', { name: /Students|Roster/i }).first();
  if (await studentsLink.isVisible().catch(() => false)) {
    await smoothClick(page, studentsLink, { holdAfterMs: 600 });
  }
  const analyticsLink = page.getByRole('link', { name: /Analytics/i }).first();
  if (await analyticsLink.isVisible().catch(() => false)) {
    await smoothClick(page, analyticsLink, { holdAfterMs: 600 });
  }
  const overlay = page.locator('[data-recorder-overlay]');
  await overlay.waitFor({ state: 'visible', timeout: 8000 });
  await hold(page, 800);
  checkpoints.push(await saveCheckpoint(page, 's05b-01-macro-recording'));

  // Click Save in RecorderOverlay -> saves macro and opens detail view
  const saveMacroBtn = overlay.getByRole('button', { name: /^Save$/i });
  await smoothClick(page, saveMacroBtn, { holdAfterMs: 900 });
  await hold(page, 1000);
  checkpoints.push(await saveCheckpoint(page, 's05b-02-macro-saved'));

  // Navigate to /automation list and replay the saved macro
  await page.goto(`${APP_URL}/automation`, { waitUntil: 'networkidle' });
  await hold(page, 700);
  const runBtn = page.getByRole('button', { name: /^Run$/i }).first();
  await smoothClick(page, runBtn, { holdAfterMs: 1800 });
  await hold(page, 1600);
  checkpoints.push(await saveCheckpoint(page, 's05b-03-macro-replay'));

  // 2b. Idempotent Alert Engine: Trigger TWICE via POST /api/alerts/run (API-only trigger)
  const adminLogin = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@university.edu', password: 'AdminPassword123!' }),
  });
  const { token: adminToken } = await adminLogin.json();

  const run1Res = await fetch(`${API_URL}/alerts/run`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const run1Json = await run1Res.json();
  const afterRun1 = JSON.parse(runMongoQuery(`
    console.log(JSON.stringify({
      totalNotifications: await db.collection('notifications').countDocuments(),
      alertNotifications: await db.collection('notifications').countDocuments({ dedupeKey: { $regex: '^alert:' } }),
    }));
  `));

  const run2Res = await fetch(`${API_URL}/alerts/run`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const run2Json = await run2Res.json();
  const afterRun2 = JSON.parse(runMongoQuery(`
    console.log(JSON.stringify({
      totalNotifications: await db.collection('notifications').countDocuments(),
      alertNotifications: await db.collection('notifications').countDocuments({ dedupeKey: { $regex: '^alert:' } }),
    }));
  `));

  await showOverlay(page, {
    badge: 'API · DEMO MODE',
    title: 'Idempotent Alert Engine — Run 1 vs. Run 2 (Zero Duplicates)',
    subtitle: 'POST /api/alerts/run · Unique dedupeKey in MongoDB · WHATSAPP_DRY_RUN=true (nothing sent externally)',
    content: JSON.stringify(
      {
        mode: 'DEMO MODE (WHATSAPP_DRY_RUN=true, ENABLE_ALERT_WHATSAPP=false)',
        mongoBefore: preCleanup,
        run1: { status: run1Res.status, result: run1Json, mongoAfterRun1: afterRun1 },
        run2: { status: run2Res.status, result: run2Json, mongoAfterRun2: afterRun2 },
        duplicatesCreatedOnRun2: afterRun2.alertNotifications - afterRun1.alertNotifications,
      },
      null,
      2,
    ),
    durationMs: 3200,
  });
  checkpoints.push(await saveCheckpoint(page, 's05b-04-alert-idempotency'));

  // Show generated alerts in Student UI (Notification bell) + mongo-express notifications
  await page.goto(`${APP_URL}/dashboard`, { waitUntil: 'networkidle' });
  await logoutViaUI(page);
  await loginViaUI(page, APP_URL, 'aarav.sharma@university.edu', 'Student123');
  const bellBtn = page.locator('button[aria-label*="notification" i], button:has(svg.lucide-bell)').first();
  if (await bellBtn.isVisible().catch(() => false)) {
    await smoothClick(page, bellBtn, { holdAfterMs: 1400 });
  } else {
    await hold(page, 1000);
  }
  checkpoints.push(await saveCheckpoint(page, 's05b-05-student-alerts-ui'));

  // Read-only mongo-express view of notifications collection (never open users)
  await openMongoExpress(page, 'notifications');
  await hold(page, 1800);
  checkpoints.push(await saveCheckpoint(page, 's05b-06-mongo-notifications'));

  await context.close();
  await browser.close();

  const webmPath = await video.path();
  const mp4Path = path.join(SCENES_DIR, `${scene.slug}.mp4`);
  convertWebmToMp4(webmPath, mp4Path);
  const dur = probeDuration(mp4Path);
  console.log(`✅ Scene 5b recorded: ${mp4Path} (${dur.toFixed(2)}s)`);
  console.log(`   Alert Run 1: generated=${run1Json.generated}, skipped=${run1Json.skipped} | Run 2: generated=${run2Json.generated}, skipped=${run2Json.skipped}`);
  console.log(`   Checkpoints: ${checkpoints.join(', ')}`);
  return mp4Path;
}
