#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import {
  APP_URL,
  API_URL,
  OUT_DIR,
  RAW_DIR,
  SCENES_DIR,
  VIEWPORT,
} from './lib/constants.mjs';
import {
  concatScenes,
  convertWebmToMp4,
  ensureDir,
  hold,
  humanType,
  installCursor,
  openMongoExpress,
  probeDuration,
  queryCollectionCounts,
  saveCheckpoint,
  showOverlay,
  showTitleCard,
  smoothClick,
} from './lib/helpers.mjs';

/**
 * Scene registry (Phase C will populate scenes 01–12; Phase B ships --smoke validator).
 */
const SCENES = [
  { id: 1, slug: '01-title-architecture', title: 'Title & Architecture Overview' },
  { id: 2, slug: '02-setup-from-scratch', title: 'Database & Set-Up From Scratch' },
  { id: 3, slug: '03-admin-overview', title: 'Admin Console & Audit' },
  { id: 4, slug: '04-teacher-attendance', title: 'Teacher Dashboard & Attendance' },
  { id: 5, slug: '05-agent-chat', title: 'Autonomous AI Agent & Approvals' },
  { id: '5b', slug: '05b-automation', title: 'Deterministic Macro Recorder & Alert Engine' },
  { id: 6, slug: '06-teacher-grading', title: 'AI Rubric Grade Batch' },
  { id: 7, slug: '07-student-journey', title: 'Student Portal, Anti-Cheat Quiz & RAG' },
  { id: '7b', slug: '07b-student-recovery', title: 'Student Attendance Recovery Plan' },
  { id: 8, slug: '08-parent-portal', title: 'Parent Read-Only Portal' },
  { id: 9, slug: '09-compliance-export', title: 'Attendance Compliance Report' },
  { id: 10, slug: '10-evidence-benchmarks', title: 'Tests, Benchmarks & Cluster Evidence' },
  { id: 11, slug: '11-mcp-server', title: 'Model Context Protocol (MCP) Server' },
  { id: 12, slug: '12-closing', title: 'Closing Summary' },
];

async function runSmokeClip({ noTitles, headless }) {
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
    number: 0,
    title: 'Phase B Recorder Validation',
    subtitle: '1920x1080 · 30fps H.264 · Red Cursor + Ripple · mongo-express · Real API Overlay',
    durationMs: 2500,
    enabled: !noTitles,
  });
  await saveCheckpoint(page, 'smoke-01-title');

  // 2. Login as admin on app with smooth cursor + click ripple + 60ms typing
  await page.goto(`${APP_URL}/signin`, { waitUntil: 'networkidle' });
  await humanType(page, page.getByLabel(/email/i).or(page.locator('input[type="email"]')).first(), 'admin@university.edu');
  await humanType(page, page.getByLabel(/password/i).or(page.locator('input[type="password"]')).first(), 'AdminPassword123!');
  await smoothClick(page, page.getByRole('button', { name: /sign in|log in/i }).first(), { holdAfterMs: 300 });
  await page.waitForURL('**/dashboard', { timeout: 15000 });
  await hold(page, 1800);
  await saveCheckpoint(page, 'smoke-02-admin-login');

  // 3. Switch to mongo-express (read-only yantra_demo) and refresh
  await openMongoExpress(page);
  await page.reload({ waitUntil: 'networkidle' });
  await hold(page, 1800);
  await saveCheckpoint(page, 'smoke-03-mongo-express');

  // 4. Overlay page with real captured API health + MongoDB collection counts
  const healthRes = await fetch(`${API_URL}/health`);
  const healthJson = await healthRes.json();
  const counts = queryCollectionCounts();
  const overlayBody = [
    '$ curl -sS http://127.0.0.1:3000/api/health',
    JSON.stringify(healthJson, null, 2),
    '',
    '# Real yantra_demo collection counts:',
    JSON.stringify(counts, null, 2),
  ].join('\n');

  await showOverlay(page, {
    badge: 'API',
    title: 'Live Health & Isolated Database Telemetry',
    subtitle: 'Captured at record time from 127.0.0.1:3000 and yantra_demo',
    content: overlayBody,
    durationMs: 2500,
  });
  await saveCheckpoint(page, 'smoke-04-overlay');

  await context.close();
  await browser.close();

  const webmPath = await video.path();
  const mp4Path = path.join(SCENES_DIR, '00-smoke-validation.mp4');
  convertWebmToMp4(webmPath, mp4Path);
  const dur = probeDuration(mp4Path);
  console.log(`✅ Smoke clip recorded: ${mp4Path} (${dur.toFixed(2)}s, 1920x1080 30fps H.264)`);
  return { mp4Path, dur };
}

function parseArgs(argv) {
  const args = {
    list: false,
    all: false,
    smoke: false,
    concat: false,
    mux: false,
    noTitles: false,
    headless: true,
    scene: null,
    exclude: new Set(),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list') args.list = true;
    else if (a === '--all') args.all = true;
    else if (a === '--smoke') args.smoke = true;
    else if (a === '--concat') args.concat = true;
    else if (a === '--mux') args.mux = true;
    else if (a === '--no-titles') args.noTitles = true;
    else if (a === '--headless') args.headless = true;
    else if (a === '--headed') args.headless = false;
    else if (a === '--scene') {
      const raw = String(argv[++i] || '').trim();
      args.scene = /^\d+$/.test(raw) ? Number.parseInt(raw, 10) : raw;
    } else if (a === '--exclude') {
      for (const id of String(argv[++i] || '').split(',')) {
        const raw = id.trim();
        if (!raw) continue;
        args.exclude.add(/^\d+$/.test(raw) ? Number.parseInt(raw, 10) : raw);
      }
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.list) {
    console.log('Available scenes:');
    for (const s of SCENES) {
      console.log(`  ${String(s.id).padStart(2, '0')}  ${s.slug.padEnd(26)}  ${s.title}`);
    }
    return;
  }

  if (args.smoke) {
    await runSmokeClip(args);
    return;
  }

  if (args.mux) {
    const demoDir = path.dirname(new URL(import.meta.url).pathname);
    const pyBin = fs.existsSync(path.join(demoDir, '.venv', 'bin', 'python'))
      ? path.join(demoDir, '.venv', 'bin', 'python')
      : 'python3';
    execFileSync(pyBin, [path.join(demoDir, 'lib', 'mux.py')], {
      cwd: demoDir,
      stdio: 'inherit',
    });
    return;
  }

  if (args.concat) {
    const included = [];
    const pending = [];
    for (const s of SCENES) {
      const mp4Path = path.join(SCENES_DIR, `${s.slug}.mp4`);
      if (args.exclude.has(s.id) || !fs.existsSync(mp4Path)) {
        pending.push({ scene: s.id, name: s.slug, status: 'PENDING' });
      } else {
        included.push({ id: s.id, name: s.slug, mp4Path });
      }
    }
    const timeline = concatScenes(
      included,
      path.join(OUT_DIR, 'full.mp4'),
      path.join(OUT_DIR, 'timeline.json'),
    );
    const fullMeta = {
      draft: pending.length > 0,
      total_duration_s: timeline.length > 0 ? timeline[timeline.length - 1].end_s : 0,
      scenes: timeline,
      pending,
    };
    fs.writeFileSync(path.join(OUT_DIR, 'timeline.json'), JSON.stringify(fullMeta, null, 2));
    console.log(`✅ Concatenated ${included.length} clean scenes -> out/full.mp4 (total ${fullMeta.total_duration_s}s)`);
    if (pending.length > 0) {
      console.log(`⏳ Pending scenes (${pending.length}): ${pending.map((p) => `${String(p.scene).padStart(2, '0')} ${p.name}`).join(', ')}`);
    }
    console.log(JSON.stringify(fullMeta, null, 2));
    return;
  }

  if (args.scene !== null || args.all) {
    const targets = args.all ? SCENES : SCENES.filter((s) => s.id === args.scene);
    if (targets.length === 0) {
      console.error(`Unknown scene: ${args.scene}. Run with --list to see valid scene numbers.`);
      process.exit(1);
    }
    const recorded = [];
    for (const s of targets) {
      const modPath = path.join(path.dirname(new URL(import.meta.url).pathname), 'scenes', `${s.slug}.mjs`);
      if (!fs.existsSync(modPath)) {
        console.log(`⏭️  Scene ${String(s.id).padStart(2, '0')} (${s.slug}) not implemented yet — skipping.`);
        continue;
      }
      const mod = await import(modPath);
      const mp4Path = await mod.recordScene({
        scene: s,
        noTitles: args.noTitles,
        headless: args.headless,
      });
      recorded.push({ id: s.id, name: s.slug, mp4Path });
    }
    if (recorded.length > 0 && args.all) {
      const timeline = concatScenes(
        recorded,
        path.join(OUT_DIR, 'full.mp4'),
        path.join(OUT_DIR, 'timeline.json'),
      );
      console.log(`✅ Concatenated ${recorded.length} scenes -> out/full.mp4`);
      console.log(JSON.stringify(timeline, null, 2));
    }
    return;
  }

  console.log('Usage: node record.mjs [--list | --smoke | --scene <N> | --all] [--no-titles] [--headless]');
}

main().catch((err) => {
  console.error('❌ Recorder failed:', err);
  process.exit(1);
});
