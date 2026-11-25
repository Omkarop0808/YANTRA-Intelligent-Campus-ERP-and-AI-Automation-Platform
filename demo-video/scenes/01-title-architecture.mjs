import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { RAW_DIR, ROOT_DIR, SCENES_DIR, VIEWPORT } from '../lib/constants.mjs';
import {
  convertWebmToMp4,
  ensureDir,
  installCursor,
  probeDuration,
  saveCheckpoint,
  showTitleCard,
} from '../lib/helpers.mjs';

export async function recordScene({ scene, noTitles = false, headless = false }) {
  ensureDir(RAW_DIR);
  ensureDir(SCENES_DIR);

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    recordVideo: { dir: RAW_DIR, size: VIEWPORT },
  });
  await installCursor(context);

  const page = await context.newPage();
  const video = page.video();

  // 1. Title card (2.5s)
  await showTitleCard(page, {
    number: scene.id,
    title: 'Yantra ERP — Intelligent Campus Platform',
    subtitle: 'Full-Stack Academic Operations, Anti-Cheat Assessments & Autonomous 46-Tool AI Agent',
    durationMs: 2500,
    enabled: !noTitles,
  });
  const cp1 = await saveCheckpoint(page, 's01-01-title');

  // 2. Full-screen architecture diagram for 6 seconds
  const archPath = path.join(ROOT_DIR, 'yantra_architecture_excalidraw_light.png');
  const b64 = fs.readFileSync(archPath).toString('base64');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: 1920px; height: 1080px; overflow: hidden;
      background: #ffffff;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      padding: 24px 36px; font-family: -apple-system, BlinkMacSystemFont, "Inter", sans-serif;
    }
    .hdr {
      width: 100%; display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 12px; color: #0f172a;
    }
    .hdr h2 { font-size: 26px; font-weight: 800; letter-spacing: -0.3px; }
    .hdr span { font-size: 16px; font-weight: 600; color: #475569; background: #f1f5f9; padding: 6px 14px; border-radius: 999px; }
    img { max-width: 100%; max-height: 980px; object-fit: contain; }
  </style></head><body>
    <div class="hdr">
      <h2>Yantra ERP — System Architecture</h2>
      <span>React 19 · Express (Node) · FastAPI + LangGraph (Gemini 3.6 Flash) · MongoDB</span>
    </div>
    <img src="data:image/png;base64,${b64}" alt="Yantra System Architecture" />
  </body></html>`;

  await page.setContent(html, { waitUntil: 'load' });
  await page.waitForTimeout(6000);
  const cp2 = await saveCheckpoint(page, 's01-02-architecture');

  await context.close();
  await browser.close();

  const webmPath = await video.path();
  const mp4Path = path.join(SCENES_DIR, `${scene.slug}.mp4`);
  convertWebmToMp4(webmPath, mp4Path);
  const dur = probeDuration(mp4Path);
  console.log(`✅ Scene 01 recorded: ${mp4Path} (${dur.toFixed(2)}s)`);
  console.log(`   Checkpoints: ${cp1}, ${cp2}`);
  return mp4Path;
}
