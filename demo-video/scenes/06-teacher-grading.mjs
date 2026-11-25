import path from 'node:path';
import { chromium } from 'playwright';
import { APP_URL, RAW_DIR, SCENES_DIR, VIEWPORT } from '../lib/constants.mjs';
import {
  convertWebmToMp4,
  ensureDir,
  hold,
  installCursor,
  loginViaUI,
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

  // Auto-accept confirm dialog when clicking "Publish all proposed"
  page.on('dialog', async (dialog) => {
    await page.waitForTimeout(600);
    await dialog.accept();
  });

  // 1. Title card
  await showTitleCard(page, {
    number: scene.id,
    title: 'AI Rubric Grade Batch & Human Approval',
    subtitle: 'Reviewing Gemini-Proposed Rubric Marks Before Publishing to Students',
    durationMs: 2500,
    enabled: !noTitles,
  });

  // 2. Log in as Prof. Adrian Miller -> open Grades (/grade-batch)
  await loginViaUI(page, APP_URL, 'prof.adrian@university.edu', 'Teacher123');
  await smoothClick(page, page.getByRole('link', { name: 'Grades' }).first(), { holdAfterMs: 600 });
  await page.waitForURL('**/grade-batch', { timeout: 15000 });
  await hold(page, 2000);

  // Click "Review Proposals" button on an assignment with AI-proposed grades
  const reviewBtn = page.getByRole('button', { name: /Review Proposals/i }).first();
  if (await reviewBtn.isVisible().catch(() => false)) {
    await smoothClick(page, reviewBtn, { holdAfterMs: 800 });
  } else {
    const anyOpenBtn = page.getByRole('button', { name: /View Results|Run AI Grading|Open/i }).first();
    await smoothClick(page, anyOpenBtn, { holdAfterMs: 800 });
  }
  await page.waitForURL('**/ai-grade', { timeout: 15000 });
  await hold(page, 2200);
  checkpoints.push(await saveCheckpoint(page, 's06-01-proposed-grades'));

  // 3. Approve & publish proposed grades
  const publishAllBtn = page.getByRole('button', { name: /Publish all proposed/i }).first();
  if (await publishAllBtn.isVisible().catch(() => false)) {
    await smoothClick(page, publishAllBtn, { holdAfterMs: 2200 });
  } else {
    const singlePublishBtn = page.getByRole('button', { name: /^Publish$/i }).first();
    if (await singlePublishBtn.isVisible().catch(() => false)) {
      await smoothClick(page, singlePublishBtn, { holdAfterMs: 2000 });
    }
  }
  await hold(page, 1800);
  checkpoints.push(await saveCheckpoint(page, 's06-02-published-grades'));

  await context.close();
  await browser.close();

  const webmPath = await video.path();
  const mp4Path = path.join(SCENES_DIR, `${scene.slug}.mp4`);
  convertWebmToMp4(webmPath, mp4Path);
  const dur = probeDuration(mp4Path);
  console.log(`✅ Scene 06 recorded: ${mp4Path} (${dur.toFixed(2)}s)`);
  console.log(`   Checkpoints: ${checkpoints.join(', ')}`);
  return mp4Path;
}
