import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { API_URL, RAW_DIR, ROOT_DIR, SCENES_DIR, VIEWPORT } from '../lib/constants.mjs';
import {
  convertWebmToMp4,
  ensureDir,
  installCursor,
  probeDuration,
  saveCheckpoint,
  showOverlay,
  showTitleCard,
} from '../lib/helpers.mjs';

export async function recordScene({ scene, noTitles = false, headless = true }) {
  ensureDir(RAW_DIR);
  ensureDir(SCENES_DIR);
  const checkpoints = [];

  // Obtain a live JWT from Express (passed ONLY via env var to mcp_server.py; never printed)
  const loginRes = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@university.edu', password: 'AdminPassword123!' }),
  });
  const { token: jwt } = await loginRes.json();
  if (!jwt) {
    throw new Error('Scene 11 failed to authenticate admin against yantra_demo');
  }

  // Real MCP stdio client handshake: list all 8 tools + invoke read-only `list_divisions`
  const pyProbe = `
import asyncio, json, os, sys
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

async def main():
    env = os.environ.copy()
    env["EXPRESS_URL"] = "http://127.0.0.1:3000/api"
    params = StdioServerParameters(
        command=sys.executable,
        args=["mcp_server.py"],
        env=env,
    )
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            tools_res = await session.list_tools()
            tools = [f"{i+1}. {t.name} — {(t.description or '').strip()}" for i, t in enumerate(tools_res.tools)]
            call_res = await session.call_tool("list_divisions", {})
            raw_text = "".join(getattr(c, "text", "") for c in call_res.content)
            try:
                parsed = json.loads(raw_text)
                divs = [{"code": d.get("code"), "name": d.get("name")} for d in parsed.get("divisions", [])]
            except Exception:
                divs = raw_text
            lines = [
                f"# 1. MCP list_tools() over stdio -> {len(tools)} tools exposed:",
                *tools,
                "",
                "# 2. MCP call_tool('list_divisions', {}) -> live yantra_demo response:",
                json.dumps({"divisions": divs}, indent=2),
            ]
            print("\\n".join(lines))

asyncio.run(main())
`;

  const mcpOutput = execFileSync('uv', ['run', 'python', '-c', pyProbe], {
    cwd: path.join(ROOT_DIR, 'python-backend'),
    env: { ...process.env, YANTRA_JWT: jwt },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

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
    title: 'Model Context Protocol (MCP) Server',
    subtitle: 'Standard stdio Tool Registry (8 Tools) & Live Read-Only Tool Execution with RBAC',
    durationMs: 2400,
    enabled: !noTitles,
  });

  // 2. TERMINAL overlay showing real stdio list_tools() + list_divisions() result (sanitized)
  await showOverlay(page, {
    badge: 'TERMINAL',
    title: 'MCP Server over stdio — list_tools() & list_divisions()',
    subtitle: 'python-backend/mcp_server.py · Captured live via mcp.client.stdio (tokens redacted)',
    content: `$ uv run python mcp_server.py (via MCP stdio ClientSession)\n${mcpOutput}`,
    durationMs: 5200,
  });
  checkpoints.push(await saveCheckpoint(page, 's11-01-mcp-stdio'));

  await context.close();
  await browser.close();

  const webmPath = await video.path();
  const mp4Path = path.join(SCENES_DIR, `${scene.slug}.mp4`);
  convertWebmToMp4(webmPath, mp4Path);
  const dur = probeDuration(mp4Path);
  console.log(`✅ Scene 11 recorded: ${mp4Path} (${dur.toFixed(2)}s)`);
  console.log(`   Checkpoints: ${checkpoints.join(', ')}`);
  return mp4Path;
}
