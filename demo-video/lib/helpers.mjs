import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  CHECKPOINTS_DIR,
  DEMO_MONGODB_URI,
  MONGO_EXPRESS_URL,
  DEMO_DB,
  ROOT_DIR,
} from './constants.mjs';

export const ensureDir = (dir) => fs.mkdirSync(dir, { recursive: true });

export const hold = (page, ms = 1800) => page.waitForTimeout(ms);

/**
 * Init script injected into every page in the recording context:
 * - Renders a visible red cursor dot that tracks mousemove smoothly
 * - Renders an expanding red click ripple on mousedown
 */
export const CURSOR_INIT_SCRIPT = () => {
  const inject = () => {
    if (document.getElementById('__demo_cursor')) return;
    const style = document.createElement('style');
    style.id = '__demo_cursor_style';
    style.textContent = `
      #__demo_cursor {
        position: fixed;
        top: 0;
        left: 0;
        width: 20px;
        height: 20px;
        margin-left: -10px;
        margin-top: -10px;
        border-radius: 50%;
        background: rgba(239, 68, 68, 0.9);
        border: 3px solid #ffffff;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
        pointer-events: none;
        z-index: 2147483647;
        transform: translate3d(-100px, -100px, 0);
        transition: transform 0.04s linear;
      }
      .__demo_ripple {
        position: fixed;
        width: 22px;
        height: 22px;
        margin-left: -11px;
        margin-top: -11px;
        border-radius: 50%;
        border: 3px solid rgba(239, 68, 68, 0.95);
        background: rgba(239, 68, 68, 0.22);
        pointer-events: none;
        z-index: 2147483646;
        animation: __demo_ripple_anim 0.55s ease-out forwards;
      }
      @keyframes __demo_ripple_anim {
        0% { transform: scale(0.7); opacity: 1; }
        100% { transform: scale(2.8); opacity: 0; }
      }
    `;
    (document.head || document.documentElement).appendChild(style);

    const cursor = document.createElement('div');
    cursor.id = '__demo_cursor';
    (document.body || document.documentElement).appendChild(cursor);

    window.addEventListener('mousemove', (e) => {
      cursor.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0)`;
    }, { passive: true });

    window.addEventListener('mousedown', (e) => {
      const ripple = document.createElement('div');
      ripple.className = '__demo_ripple';
      ripple.style.left = `${e.clientX}px`;
      ripple.style.top = `${e.clientY}px`;
      (document.body || document.documentElement).appendChild(ripple);
      setTimeout(() => ripple.remove(), 600);
    }, { passive: true });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject, { once: true });
  } else {
    inject();
  }
};

export async function installCursor(context) {
  await context.addInitScript(CURSOR_INIT_SCRIPT);
}

export async function smoothClick(page, locator, { steps = 18, holdAfterMs = 400 } = {}) {
  await locator.waitFor({ state: 'visible', timeout: 15000 });
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (box) {
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy, { steps });
    await page.waitForTimeout(120);
    await page.mouse.down();
    await page.waitForTimeout(90);
    await page.mouse.up();
  } else {
    await locator.click();
  }
  if (holdAfterMs > 0) await page.waitForTimeout(holdAfterMs);
}

export async function humanType(page, locator, text, { delayMs = 60, clear = true } = {}) {
  await smoothClick(page, locator, { holdAfterMs: 120 });
  if (clear) {
    await locator.fill('');
  }
  await page.keyboard.type(text, { delay: delayMs });
  await page.waitForTimeout(200);
}

const escapeHtml = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

/**
 * General sanitizer applied to EVERY overlay before rendering on screen.
 * Masks passwords, JWTs, bearer tokens, bcrypt hashes, and API keys.
 */
export function sanitizeOverlayText(raw) {
  let text = String(raw ?? '');
  // Mask JSON password / passwordHash / token / accessToken / secret / apiKey string values
  text = text.replace(
    /("(?:password|passwordHash|token|accessToken|refreshToken|jwt|apiKey|api_key|secret|authorization)"\s*:\s*")([^"]*)(")/gi,
    '$1***$3',
  );
  // Mask Authorization: Bearer <token>
  text = text.replace(/(Bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi, '$1***');
  // Mask raw JWTs (eyJ...)
  text = text.replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[REDACTED_JWT]');
  // Mask bcrypt hashes ($2a$, $2b$, $2y$)
  text = text.replace(/\$2[aby]\$\d{2}\$[./A-Za-z0-9]{20,}/g, '[REDACTED_HASH]');
  // Mask Google/Gemini API keys (AIza...)
  text = text.replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, '[REDACTED_API_KEY]');
  return text;
}

/**
 * Hard fail-fast leak scanner run on every overlay after sanitization.
 * Throws if any raw secret, unmasked password/token value, bcrypt hash, or JWT appears.
 */
export function assertNoRawSecrets(text, contextLabel = 'overlay') {
  const s = String(text ?? '');
  const checks = [
    { name: 'bcrypt hash ($2a/$2b/$2y)', re: /\$2[aby]\$/ },
    { name: 'raw JWT (eyJ...)', re: /\beyJ[A-Za-z0-9_-]{8,}\./ },
    { name: 'raw Google API key (AIza...)', re: /\bAIza[0-9A-Za-z_-]{10,}/ },
    {
      name: 'unmasked password field',
      re: /"password(?:Hash)?"\s*:\s*"(?!\*\*\*")[^"]+"/i,
    },
    {
      name: 'unmasked token field',
      re: /"(?:access|refresh)?token"\s*:\s*"(?!\*\*\*")[^"]+"/i,
    },
  ];
  for (const c of checks) {
    if (c.re.test(s)) {
      throw new Error(`SECRET LEAK GUARD triggered in ${contextLabel}: matched ${c.name}`);
    }
  }
}

export async function showTitleCard(page, { number, title, subtitle = '', durationMs = 2500, enabled = true }) {
  if (!enabled) return;
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: 1920px; height: 1080px; overflow: hidden;
      background: radial-gradient(circle at 20% 20%, #1e3a8a 0%, #0f172a 60%, #020617 100%);
      color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, "Inter", sans-serif;
      display: flex; align-items: center; justify-content: center;
    }
    .card { text-align: center; max-width: 1300px; padding: 48px; }
    .pill {
      display: inline-block; padding: 10px 24px; border-radius: 999px;
      background: rgba(59, 130, 246, 0.22); border: 1px solid rgba(96, 165, 250, 0.45);
      color: #93c5fd; font-size: 22px; font-weight: 700; letter-spacing: 2px;
      text-transform: uppercase; margin-bottom: 28px;
    }
    h1 { font-size: 72px; font-weight: 800; letter-spacing: -1.5px; line-height: 1.1; margin-bottom: 22px; }
    p { font-size: 30px; color: #cbd5e1; line-height: 1.45; }
  </style></head><body><div class="card">
    <div class="pill">Scene ${escapeHtml(String(number).padStart(2, '0'))} · Yantra ERP</div>
    <h1>${escapeHtml(title)}</h1>
    ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}
  </div></body></html>`;
  await page.setContent(html, { waitUntil: 'load' });
  await page.waitForTimeout(durationMs);
}

export async function showOverlay(page, { badge = 'TERMINAL', title, subtitle = '', content, durationMs = 3000 }) {
  const safeTitle = sanitizeOverlayText(title);
  const safeSubtitle = sanitizeOverlayText(subtitle);
  const safeContent = sanitizeOverlayText(content);
  assertNoRawSecrets(`${safeTitle}\n${safeSubtitle}\n${safeContent}`, `showOverlay(${badge}: ${safeTitle})`);

  const badgeColor =
    badge === 'API' ? '#2563eb'
    : badge === 'DEMO MODE' ? '#d97706'
    : badge === 'SETUP SCRIPT' ? '#7c3aed'
    : '#059669';

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: 1920px; height: 1080px; overflow: hidden;
      background: #0b1120; color: #e2e8f0;
      font-family: -apple-system, BlinkMacSystemFont, "Inter", sans-serif;
      padding: 56px 72px; display: flex; flex-direction: column; gap: 24px;
    }
    .hdr { display: flex; align-items: center; gap: 18px; }
    .badge {
      background: ${badgeColor}; color: #fff; font-weight: 800; font-size: 18px;
      letter-spacing: 1.4px; padding: 8px 18px; border-radius: 8px; text-transform: uppercase;
    }
    h1 { font-size: 38px; font-weight: 800; color: #f8fafc; }
    .sub { font-size: 20px; color: #94a3b8; margin-top: -12px; }
    pre {
      flex: 1; background: #0f172a; border: 1px solid #1e293b; border-radius: 14px;
      padding: 28px 32px; font-family: "SF Mono", Menlo, Monaco, Consolas, monospace;
      font-size: 19px; line-height: 1.5; color: #e2e8f0; overflow: hidden;
      white-space: pre-wrap; word-break: break-word;
      box-shadow: 0 20px 45px rgba(0, 0, 0, 0.45);
    }
  </style></head><body>
    <div class="hdr">
      <span class="badge">${escapeHtml(badge)}</span>
      <h1>${escapeHtml(safeTitle)}</h1>
    </div>
    ${safeSubtitle ? `<div class="sub">${escapeHtml(safeSubtitle)}</div>` : ''}
    <pre>${escapeHtml(safeContent)}</pre>
  </body></html>`;
  await page.setContent(html, { waitUntil: 'load' });
  await page.waitForTimeout(durationMs);
}

export async function showCollectionDiffTable(page, { title, beforeCounts, afterCounts, durationMs = 4000 }) {
  const keys = Array.from(new Set([...Object.keys(beforeCounts), ...Object.keys(afterCounts)])).sort();
  const rows = keys
    .map((k) => {
      const b = beforeCounts[k] ?? 0;
      const a = afterCounts[k] ?? 0;
      const delta = a - b;
      const cls = delta > 0 ? 'pos' : delta < 0 ? 'neg' : 'zero';
      const deltaStr = delta > 0 ? `+${delta}` : String(delta);
      return `<tr><td class="col">${escapeHtml(k)}</td><td>${b}</td><td>${a}</td><td class="${cls}">${deltaStr}</td></tr>`;
    })
    .join('');

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: 1920px; height: 1080px; overflow: hidden;
      background: #0b1120; color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, "Inter", sans-serif;
      padding: 36px 96px; display: flex; flex-direction: column; gap: 16px;
    }
    h1 { font-size: 36px; font-weight: 800; }
    .sub { color: #94a3b8; font-size: 18px; }
    table { width: 100%; border-collapse: collapse; background: #0f172a; border-radius: 14px; overflow: hidden; border: 1px solid #1e293b; }
    th, td { padding: 10px 22px; text-align: left; font-size: 18px; border-bottom: 1px solid #1e293b; }
    th { background: #1e293b; color: #cbd5e1; text-transform: uppercase; font-size: 16px; letter-spacing: 1px; }
    td.col { font-family: "SF Mono", Menlo, monospace; color: #93c5fd; font-weight: 600; }
    td.pos { color: #4ade80; font-weight: 800; }
    td.neg { color: #f87171; font-weight: 800; }
    td.zero { color: #64748b; }
  </style></head><body>
    <h1>${escapeHtml(title)}</h1>
    <div class="sub">Real MongoDB collection counts from database: ${escapeHtml(DEMO_DB)}</div>
    <table><thead><tr><th>Collection</th><th>Before</th><th>After</th><th>Delta</th></tr></thead><tbody>${rows}</tbody></table>
  </body></html>`;
  await page.setContent(html, { waitUntil: 'load' });
  await page.waitForTimeout(durationMs);
}

/**
 * Query real collection counts from yantra_demo via express-backend's mongoose.
 */
export function queryCollectionCounts() {
  const script = `
    const mongoose = require('mongoose');
    (async () => {
      await mongoose.connect(process.env.MONGODB_URI);
      const db = mongoose.connection.db;
      const cols = await db.listCollections().toArray();
      const out = {};
      for (const c of cols) {
        out[c.name] = await db.collection(c.name).countDocuments();
      }
      console.log(JSON.stringify(out));
      await mongoose.disconnect();
    })();
  `;
  const raw = execFileSync(process.execPath, ['-e', script], {
    cwd: path.join(ROOT_DIR, 'express-backend'),
    env: { ...process.env, MONGODB_URI: DEMO_MONGODB_URI },
    encoding: 'utf8',
  });
  return JSON.parse(raw.trim());
}

export function runMongoQuery(jsBody) {
  const script = `
    const mongoose = require('mongoose');
    (async () => {
      await mongoose.connect(process.env.MONGODB_URI);
      const db = mongoose.connection.db;
      ${jsBody}
      await mongoose.disconnect();
    })().catch((e) => { console.error(e); process.exit(1); });
  `;
  const raw = execFileSync(process.execPath, ['-e', script], {
    cwd: path.join(ROOT_DIR, 'express-backend'),
    env: { ...process.env, MONGODB_URI: DEMO_MONGODB_URI },
    encoding: 'utf8',
  });
  return raw.trim();
}

export async function loginViaUI(page, appUrl, email, password) {
  await page.goto(`${appUrl}/signin`, { waitUntil: 'networkidle' });
  await humanType(page, page.locator('input[type="email"]').first(), email);
  await humanType(page, page.locator('input[type="password"]').first(), password);
  await smoothClick(page, page.getByRole('button', { name: /sign in|log in/i }).first(), { holdAfterMs: 300 });
  await page.waitForURL('**/dashboard', { timeout: 15000 });
  await hold(page, 1600);
}

export async function logoutViaUI(page) {
  const logoutLink = page.getByRole('link', { name: /logout/i }).first();
  await smoothClick(page, logoutLink, { holdAfterMs: 400 });
  await page.waitForURL('**/signin', { timeout: 15000 });
  await hold(page, 1200);
}

/**
 * Navigate/refresh mongo-express on 127.0.0.1:8081.
 * Safety guard: NEVER opens documents inside the users collection.
 */
export async function openMongoExpress(page, collection = '') {
  if (collection.toLowerCase().startsWith('users')) {
    throw new Error('POLICY BLOCK: Never open documents in the users collection; show database counts only.');
  }
  const url = collection
    ? `${MONGO_EXPRESS_URL}/db/${DEMO_DB}/${collection}`
    : `${MONGO_EXPRESS_URL}/db/${DEMO_DB}/`;
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
}

export async function saveCheckpoint(page, name) {
  ensureDir(CHECKPOINTS_DIR);
  const filePath = path.join(CHECKPOINTS_DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: false });
  return filePath;
}

export function convertWebmToMp4(webmPath, mp4Path) {
  ensureDir(path.dirname(mp4Path));
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-i', webmPath,
      '-c:v', 'libx264',
      '-r', '30',
      '-pix_fmt', 'yuv420p',
      '-preset', 'fast',
      '-crf', '20',
      '-movflags', '+faststart',
      mp4Path,
    ],
    { stdio: 'pipe' },
  );
  return mp4Path;
}

export function probeDuration(mp4Path) {
  const out = execFileSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', mp4Path],
    { encoding: 'utf8' },
  );
  return Number.parseFloat(out.trim()) || 0;
}

export function concatScenes(sceneEntries, fullMp4Path, timelinePath) {
  ensureDir(path.dirname(fullMp4Path));
  const listFile = path.join(path.dirname(fullMp4Path), '_concat_list.txt');
  const lines = sceneEntries.map((s) => `file '${s.mp4Path.replace(/'/g, "'\\''")}'`);
  fs.writeFileSync(listFile, lines.join('\n') + '\n', 'utf8');

  // Re-encode on concat with uniform 30fps, clean keyframes (-g 60), yuv420p, and +faststart
  // to eliminate H.264 stream-copy timestamp/boundary glitches in players.
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-fflags', '+genpts',
      '-f', 'concat',
      '-safe', '0',
      '-i', listFile,
      '-c:v', 'libx264',
      '-r', '30',
      '-pix_fmt', 'yuv420p',
      '-preset', 'fast',
      '-crf', '20',
      '-g', '60',
      '-movflags', '+faststart',
      '-an',
      fullMp4Path,
    ],
    { stdio: 'pipe' },
  );
  fs.unlinkSync(listFile);

  let cursor = 0;
  const timeline = sceneEntries.map((s) => {
    const dur = probeDuration(s.mp4Path);
    const entry = {
      scene: s.id,
      name: s.name,
      file: path.relative(path.dirname(fullMp4Path), s.mp4Path),
      start_s: Number(cursor.toFixed(2)),
      end_s: Number((cursor + dur).toFixed(2)),
      duration_s: Number(dur.toFixed(2)),
    };
    cursor += dur;
    return entry;
  });

  fs.writeFileSync(timelinePath, JSON.stringify({ total_duration_s: Number(cursor.toFixed(2)), scenes: timeline }, null, 2));
  return timeline;
}
