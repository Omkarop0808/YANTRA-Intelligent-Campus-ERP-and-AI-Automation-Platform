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
    title: 'Parent Read-Only Portal',
    subtitle: 'IDOR-Protected Visibility for Linked Children · Zero Write or Mutation Controls',
    durationMs: 2500,
    enabled: !noTitles,
  });

  // 2. Log in as seeded parent.sharma@university.edu
  await loginViaUI(page, APP_URL, 'parent.sharma@university.edu', 'Parent123!');
  await hold(page, 2400);
  checkpoints.push(await saveCheckpoint(page, 's08-01-parent-dashboard'));

  // Scroll smoothly to show read-only attendance/overview with no edit/delete buttons
  await page.evaluate(() => window.scrollTo({ top: 380, behavior: 'smooth' }));
  await hold(page, 2200);
  checkpoints.push(await saveCheckpoint(page, 's08-02-parent-readonly'));

  await page.evaluate(() => window.scrollTo({ top: 0 }));
  await logoutViaUI(page);

  await context.close();
  await browser.close();

  const webmPath = await video.path();
  const mp4Path = path.join(SCENES_DIR, `${scene.slug}.mp4`);
  convertWebmToMp4(webmPath, mp4Path);
  const dur = probeDuration(mp4Path);
  console.log(`✅ Scene 08 recorded: ${mp4Path} (${dur.toFixed(2)}s)`);
  console.log(`   Checkpoints: ${checkpoints.join(', ')}`);
  return mp4Path;
}
