import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { chromium } from 'playwright';
import { RAW_DIR, ROOT_DIR, SCENES_DIR, VIEWPORT } from '../lib/constants.mjs';
import {
  assertNoRawSecrets,
  convertWebmToMp4,
  ensureDir,
  hold,
  installCursor,
  probeDuration,
  sanitizeOverlayText,
  saveCheckpoint,
  showOverlay,
  showTitleCard,
} from '../lib/helpers.mjs';

const escapeHtml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function runCmd(cmd, cwd) {
  try {
    return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (err) {
    const out = [err.stdout, err.stderr].filter(Boolean).join('\n').trim();
    return out || String(err.message);
  }
}

export async function recordScene({ scene, noTitles = false, headless = true }) {
  ensureDir(RAW_DIR);
  ensureDir(SCENES_DIR);
  const checkpoints = [];

  // (a) Capture REAL test runs at record time (offline Python suite + Express npm test)
  const pytestCmd =
    'uv run pytest -q tests/test_gemini_models.py tests/test_proxy_rate_limit.py tests/test_ingest.py';
  const pytestOut = runCmd(pytestCmd, path.join(ROOT_DIR, 'python-backend'));

  const expressOutRaw = runCmd('npm test', path.join(ROOT_DIR, 'express-backend'));
  // Keep summary lines concise and readable
  const expressLines = expressOutRaw.split('\n');
  const expressSummary = expressLines
    .filter((l) => /^(\s*▶|\s*✔|\s*✖|ℹ )/.test(l))
    .join('\n') || expressLines.slice(-20).join('\n');

  // (b) Read real benchmark_results.json directly (never retyped)
  const benchPath = path.join(ROOT_DIR, 'benchmark_results.json');
  if (!fs.existsSync(benchPath)) {
    throw new Error(`benchmark_results.json not found at ${benchPath}`);
  }
  const bench = JSON.parse(fs.readFileSync(benchPath, 'utf8'));

  // (c) Capture real `docker compose ps` output at record time
  const dockerPsOut = runCmd('docker compose ps', ROOT_DIR);

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
    title: 'Verification Evidence, Benchmarks & Containers',
    subtitle: 'Real Captured Test Suites · Horizontal Scaling Benchmarks · Docker Compose Status',
    durationMs: 2400,
    enabled: !noTitles,
  });

  // 2a. Real captured test outputs (Python offline suite + Express npm test)
  const testOutputBlock = [
    `$ cd python-backend && ${pytestCmd}`,
    pytestOut,
    '',
    '$ cd express-backend && npm test',
    expressSummary,
  ].join('\n');

  await showOverlay(page, {
    badge: 'TERMINAL',
    title: 'Automated Test Suites (Captured Live at Record Time)',
    subtitle: 'Python Offline Unit Suite (Gemini Models, Proxy Rate Limit, Notice Ingest) + Express RBAC & Relational Links',
    content: testOutputBlock,
    durationMs: 4200,
  });
  checkpoints.push(await saveCheckpoint(page, 's10-01-tests-terminal'));

  // 2b. Benchmark table rendered directly from benchmark_results.json
  const meta = bench.metadata || {};
  const scalingRows = (bench.container_scaling_comparison?.results || [])
    .map(
      (r) => `<tr>
        <td>${escapeHtml(r.scenario)}</td>
        <td class="num">c=${escapeHtml(r.concurrency)}</td>
        <td class="num">${escapeHtml(r.one_instance_rps)}</td>
        <td class="num">${escapeHtml(r.two_instance_rps)}</td>
        <td class="num accent">${escapeHtml(r.scaling_factor)}x</td>
        <td class="num">${escapeHtml(r.one_instance_p95_ms)} ms</td>
        <td class="num">${escapeHtml(r.two_instance_p95_ms)} ms</td>
        <td class="num ok">${escapeHtml(r.two_instance_err_pct)}%</td>
      </tr>`,
    )
    .join('');

  const bc = bench.bcrypt_optimization || {};
  const benchConditions = `${meta.cpu_brand || 'Apple Silicon'} · ${meta.total_ram_gb || '?'} GB RAM · ${meta.os_name || ''} ${meta.machine || ''} · Node ${meta.node_version || ''} · Python ${meta.python_version || ''} · commit ${meta.commit_hash || ''} · Load generator on same machine · Relaxed rate limits via .env.bench`;
  const benchCheckText = sanitizeOverlayText(benchConditions + '\n' + JSON.stringify(bench.container_scaling_comparison || {}));
  assertNoRawSecrets(benchCheckText, 'Scene 10 benchmark table');

  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"><style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { width: 1920px; height: 1080px; background: #0b1120; color: #f8fafc; font-family: -apple-system, Inter, sans-serif; padding: 48px 64px; display: flex; flex-direction: column; gap: 22px; }
      .top { display: flex; align-items: center; gap: 16px; }
      .badge { background: #1d4ed8; color: #fff; font-weight: 800; padding: 8px 16px; border-radius: 8px; font-size: 16px; letter-spacing: 0.8px; }
      h1 { font-size: 36px; font-weight: 800; }
      .cond { background: #0f172a; border: 1px solid #1e293b; border-radius: 10px; padding: 14px 20px; color: #93c5fd; font-size: 17px; font-family: "SF Mono", Menlo, monospace; }
      table { width: 100%; border-collapse: collapse; background: #0f172a; border: 1px solid #1e293b; border-radius: 12px; overflow: hidden; }
      th, td { padding: 15px 18px; text-align: left; border-bottom: 1px solid #1e293b; font-size: 19px; }
      th { background: #1e293b; color: #cbd5e1; font-size: 15px; text-transform: uppercase; letter-spacing: 0.7px; }
      td.num, th.num { text-align: right; font-family: "SF Mono", Menlo, monospace; }
      td.accent { color: #38bdf8; font-weight: 800; }
      td.ok { color: #4ade80; font-weight: 700; }
      .bcrypt { background: #0f172a; border: 1px solid #1e293b; border-left: 5px solid #10b981; border-radius: 12px; padding: 20px 24px; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 20px; }
      .b-label { font-size: 14px; text-transform: uppercase; letter-spacing: 0.8px; color: #94a3b8; margin-bottom: 6px; }
      .b-val { font-size: 22px; font-weight: 800; color: #f8fafc; font-family: "SF Mono", Menlo, monospace; }
      .b-sub { font-size: 15px; color: #94a3b8; margin-top: 4px; }
    </style></head><body>
      <div class="top"><span class="badge">BENCHMARK_RESULTS.JSON</span><h1>Measured Throughput &amp; 1-vs-2 Instance Container Scaling</h1></div>
      <div class="cond">${escapeHtml(benchConditions)}</div>
      <table>
        <thead>
          <tr>
            <th>Scenario (Nginx -&gt; 1 vs 2 Instances)</th>
            <th class="num">Conc.</th>
            <th class="num">1-Inst RPS</th>
            <th class="num">2-Inst RPS</th>
            <th class="num">Scaling</th>
            <th class="num">1-Inst p95</th>
            <th class="num">2-Inst p95</th>
            <th class="num">Errors</th>
          </tr>
        </thead>
        <tbody>${scalingRows}</tbody>
      </table>
      <div class="bcrypt">
        <div>
          <div class="b-label">Before (Pure-JS bcryptjs · c=25)</div>
          <div class="b-val">${escapeHtml(bc.before_pure_js_bcryptjs?.c25?.rps)} RPS</div>
          <div class="b-sub">p95 ${escapeHtml(bc.before_pure_js_bcryptjs?.c25?.p95_ms)} ms (${escapeHtml(bc.before_pure_js_bcryptjs?.c25?.status)})</div>
        </div>
        <div>
          <div class="b-label">After (Native C++ libuv bcrypt · c=25)</div>
          <div class="b-val">${escapeHtml(bc.after_native_c_libuv_bcrypt?.c25?.rps)} RPS</div>
          <div class="b-sub">p95 ${escapeHtml(bc.after_native_c_libuv_bcrypt?.c25?.p95_ms)} ms (${escapeHtml(bc.after_native_c_libuv_bcrypt?.c25?.status)})</div>
        </div>
        <div>
          <div class="b-label">Measured Delta (c=25)</div>
          <div class="b-val" style="color:#4ade80;">${escapeHtml(bc.delta?.c25_throughput_scaling)} RPS · ${escapeHtml(bc.delta?.c25_latency_p95_reduction)} p95↓</div>
          <div class="b-sub">Source: benchmark_results.json (read directly)</div>
        </div>
      </div>
    </body></html>`,
    { waitUntil: 'load' },
  );
  await hold(page, 4600);
  checkpoints.push(await saveCheckpoint(page, 's10-02-benchmarks-table'));

  // 2c. Real captured `docker compose ps` output
  await showOverlay(page, {
    badge: 'TERMINAL',
    title: 'Container Runtime Status (docker compose ps)',
    subtitle: 'Captured live at record time from workspace root',
    content: `$ docker compose ps\n${dockerPsOut || '(no running docker compose services)'}`,
    durationMs: 3200,
  });
  checkpoints.push(await saveCheckpoint(page, 's10-03-docker-ps'));

  await context.close();
  await browser.close();

  const webmPath = await video.path();
  const mp4Path = path.join(SCENES_DIR, `${scene.slug}.mp4`);
  convertWebmToMp4(webmPath, mp4Path);
  const dur = probeDuration(mp4Path);
  console.log(`✅ Scene 10 recorded: ${mp4Path} (${dur.toFixed(2)}s)`);
  console.log(`   Checkpoints: ${checkpoints.join(', ')}`);
  return mp4Path;
}
