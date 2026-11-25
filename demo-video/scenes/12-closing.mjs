import path from 'node:path';
import { chromium } from 'playwright';
import { RAW_DIR, SCENES_DIR, VIEWPORT } from '../lib/constants.mjs';
import {
  convertWebmToMp4,
  ensureDir,
  hold,
  installCursor,
  probeDuration,
  saveCheckpoint,
} from '../lib/helpers.mjs';

export async function recordScene({ scene, headless = true }) {
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

  // Closing card: Project name Yantra + 6-person team name Karatsuba (no private repo URL)
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"><style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        width: 1920px; height: 1080px;
        background: radial-gradient(circle at 25% 20%, #1e3a8a 0%, #0f172a 55%, #020617 100%);
        color: #f8fafc;
        font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif;
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        text-align: center; padding: 80px;
      }
      .pill {
        display: inline-block;
        padding: 10px 26px;
        border-radius: 999px;
        background: rgba(59, 130, 246, 0.2);
        border: 1px solid rgba(147, 197, 253, 0.45);
        color: #93c5fd;
        font-size: 20px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase;
        margin-bottom: 28px;
      }
      h1 { font-size: 92px; font-weight: 900; letter-spacing: -2px; line-height: 1.05; margin-bottom: 20px; }
      .sub { font-size: 32px; color: #cbd5e1; max-width: 1120px; line-height: 1.45; margin-bottom: 52px; }
      .team-card {
        background: rgba(15, 23, 42, 0.72);
        border: 1px solid rgba(148, 163, 184, 0.3);
        border-radius: 20px;
        padding: 28px 56px;
      }
      .team-label { font-size: 16px; text-transform: uppercase; letter-spacing: 2px; color: #94a3b8; margin-bottom: 8px; }
      .team-name { font-size: 44px; font-weight: 800; color: #38bdf8; letter-spacing: -0.5px; }
      .team-note { font-size: 20px; color: #cbd5e1; margin-top: 6px; }
    </style></head><body>
      <div class="pill">THANK YOU FOR WATCHING</div>
      <h1>Yantra</h1>
      <p class="sub">Autonomous Academic Operations ERP · Role-Based Governance, Human-in-the-Loop AI Approvals &amp; Deterministic Retrieval</p>
      <div class="team-card">
        <div class="team-label">Built by</div>
        <div class="team-name">Team Karatsuba</div>
        <div class="team-note">6-Member Engineering Team</div>
      </div>
    </body></html>`,
    { waitUntil: 'load' },
  );
  await hold(page, 4500);
  checkpoints.push(await saveCheckpoint(page, 's12-01-closing-card'));

  await context.close();
  await browser.close();

  const webmPath = await video.path();
  const mp4Path = path.join(SCENES_DIR, `${scene.slug}.mp4`);
  convertWebmToMp4(webmPath, mp4Path);
  const dur = probeDuration(mp4Path);
  console.log(`✅ Scene 12 recorded: ${mp4Path} (${dur.toFixed(2)}s)`);
  console.log(`   Checkpoints: ${checkpoints.join(', ')}`);
  return mp4Path;
}
