import path from 'node:path';
import { chromium } from 'playwright';
import { APP_URL, RAW_DIR, SCENES_DIR, VIEWPORT } from '../lib/constants.mjs';
import {
  convertWebmToMp4,
  ensureDir,
  hold,
  installCursor,
  loginViaUI,
  logoutViaUI,
  probeDuration,
  saveCheckpoint,
  showTitleCard,
  smoothClick,
} from '../lib/helpers.mjs';

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
    title: 'Admin Console & Audit',
    subtitle: 'Institution Overview, Faculty Verification Queue & Agent Audit Trail',
    durationMs: 2500,
    enabled: !noTitles,
  });

  // 2. Log in as admin -> Admin Overview dashboard
  await loginViaUI(page, APP_URL, 'admin@university.edu', 'AdminPassword123!');
  await hold(page, 2400);
  checkpoints.push(await saveCheckpoint(page, 's03-01-admin-dashboard'));

  // 3. Navigate to Teacher Verifications & Agent Audit Log (/admin)
  await smoothClick(page, page.getByRole('link', { name: 'Teacher Verifications' }).first(), { holdAfterMs: 600 });
  await page.waitForURL('**/admin', { timeout: 15000 });
  await hold(page, 1800);

  // Scroll to show the Agent Audit Log section on /admin
  await page.evaluate(() => window.scrollTo({ top: 450, behavior: 'smooth' }));
  await hold(page, 2200);
  checkpoints.push(await saveCheckpoint(page, 's03-02-admin-audit'));

  // 4. Log out cleanly
  await logoutViaUI(page);

  await context.close();
  await browser.close();

  const webmPath = await video.path();
  const mp4Path = path.join(SCENES_DIR, `${scene.slug}.mp4`);
  convertWebmToMp4(webmPath, mp4Path);
  const dur = probeDuration(mp4Path);
  console.log(`✅ Scene 03 recorded: ${mp4Path} (${dur.toFixed(2)}s)`);
  console.log(`   Checkpoints: ${checkpoints.join(', ')}`);
  return mp4Path;
}
