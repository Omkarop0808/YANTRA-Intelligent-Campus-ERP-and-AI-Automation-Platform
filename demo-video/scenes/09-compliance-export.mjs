import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { API_URL, OUT_DIR, RAW_DIR, SCENES_DIR, VIEWPORT } from '../lib/constants.mjs';
import {
  convertWebmToMp4,
  ensureDir,
  hold,
  installCursor,
  probeDuration,
  saveCheckpoint,
  showOverlay,
  showTitleCard,
} from '../lib/helpers.mjs';

export async function recordScene({ scene, noTitles = false, headless = false }) {
  ensureDir(RAW_DIR);
  ensureDir(SCENES_DIR);
  const checkpoints = [];

  // 1. Login as Admin via API and fetch TE-A division ID
  const loginRes = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@university.edu', password: 'AdminPassword123!' }),
  });
  const { token: adminToken } = await loginRes.json();

  const divsRes = await fetch(`${API_URL}/academic/divisions`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const divsJson = await divsRes.json();
  const teA = (divsJson.divisions || []).find((d) => d.code === 'TE-A') || divsJson.divisions[0];

  // 2. Fetch real CSV & PDF compliance reports
  const csvRes = await fetch(`${API_URL}/reports/attendance-compliance?division=${teA._id}&format=csv`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const csvText = await csvRes.text();

  const pdfRes = await fetch(`${API_URL}/reports/attendance-compliance?division=${teA._id}&format=pdf`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
  const pdfPath = path.join(OUT_DIR, 'compliance_report.pdf');
  fs.writeFileSync(pdfPath, pdfBuf);

  // Render Page 1 of the PDF to PNG using macOS qlmanage
  execFileSync('qlmanage', ['-t', '-s', '1600', '-o', OUT_DIR, pdfPath], { stdio: 'pipe' });
  const pdfPngPath = `${pdfPath}.png`;
  const pdfPngB64 = fs.readFileSync(pdfPngPath).toString('base64');

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    recordVideo: { dir: RAW_DIR, size: VIEWPORT },
  });
  await installCursor(context);

  const page = await context.newPage();
  const video = page.video();

  // 3. Title card
  await showTitleCard(page, {
    number: scene.id,
    title: 'Attendance Compliance Report Export',
    subtitle: 'Server-Side CSV & PDFKit Compliance Streaming (Admin & Faculty RBAC)',
    durationMs: 2500,
    enabled: !noTitles,
  });

  // 4. API overlay showing real captured CSV response & PDF byte count
  await showOverlay(page, {
    badge: 'API',
    title: 'Attendance Compliance Export (CSV & PDF)',
    subtitle: `GET /api/reports/attendance-compliance?division=${teA._id}&format=csv|pdf (TE-A)`,
    content: [
      `# CSV Export: HTTP ${csvRes.status} (${csvText.length} bytes)`,
      csvText.split('\n').slice(0, 18).join('\n'),
      '',
      `# PDF Export: HTTP ${pdfRes.status} (${pdfBuf.length} bytes, Content-Type: ${pdfRes.headers.get('content-type')})`,
    ].join('\n'),
    durationMs: 3600,
  });
  checkpoints.push(await saveCheckpoint(page, 's09-01-compliance-csv-api'));

  // 5. Render Page 1 of the generated PDF full-screen as an image
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: 1920px; height: 1080px; background: #0f172a; color: #f8fafc;
      font-family: -apple-system, Inter, sans-serif;
      display: flex; flex-direction: column; align-items: center; padding: 28px 48px; gap: 16px;
    }
    .hdr { width: 100%; display: flex; justify-content: space-between; align-items: center; }
    .hdr h2 { font-size: 26px; font-weight: 800; }
    .hdr span { background: #2563eb; padding: 6px 14px; border-radius: 8px; font-weight: 700; font-size: 16px; }
    img { max-height: 960px; max-width: 100%; object-fit: contain; border-radius: 10px; box-shadow: 0 20px 50px rgba(0,0,0,0.5); background: #fff; }
  </style></head><body>
    <div class="hdr">
      <h2>Generated Compliance Report — Page 1 (${teA.code})</h2>
      <span>PDFKit · ${pdfBuf.length} bytes</span>
    </div>
    <img src="data:image/png;base64,${pdfPngB64}" alt="Compliance Report PDF Page 1" />
  </body></html>`, { waitUntil: 'load' });
  await hold(page, 3800);
  checkpoints.push(await saveCheckpoint(page, 's09-02-compliance-pdf-p1'));

  await context.close();
  await browser.close();

  const webmPath = await video.path();
  const mp4Path = path.join(SCENES_DIR, `${scene.slug}.mp4`);
  convertWebmToMp4(webmPath, mp4Path);
  const dur = probeDuration(mp4Path);
  console.log(`✅ Scene 09 recorded: ${mp4Path} (${dur.toFixed(2)}s)`);
  console.log(`   Checkpoints: ${checkpoints.join(', ')}`);
  return mp4Path;
}
