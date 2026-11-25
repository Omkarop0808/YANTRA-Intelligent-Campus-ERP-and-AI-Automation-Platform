import path from 'node:path';
import { chromium } from 'playwright';
import { APP_URL, RAW_DIR, SCENES_DIR, VIEWPORT } from '../lib/constants.mjs';
import {
  convertWebmToMp4,
  ensureDir,
  hold,
  humanType,
  installCursor,
  loginViaUI,
  openMongoExpress,
  probeDuration,
  runMongoQuery,
  saveCheckpoint,
  showOverlay,
  showTitleCard,
  smoothClick,
} from '../lib/helpers.mjs';

const ACTIVE_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';

async function sendPromptAndApprove(page, promptText, { checkpointCard, checkpointAfter }) {
  const input = page.locator('textarea, input[placeholder*="command" i], input[placeholder*="question" i]').first();
  let approved = false;

  for (let attempt = 0; attempt < 2; attempt++) {
    await humanType(page, input, promptText, { delayMs: 35 });
    await page.keyboard.press('Enter');

    const submitBtn = page.getByRole('button', { name: /^Submit$/i }).last();
    const appeared = await submitBtn
      .waitFor({ state: 'visible', timeout: 60000 })
      .then(() => true)
      .catch(() => false);

    if (appeared) {
      await submitBtn.scrollIntoViewIfNeeded();
      await hold(page, 2200);
      if (checkpointCard) await saveCheckpoint(page, checkpointCard);
      await smoothClick(page, submitBtn, { holdAfterMs: 800 });
      // Wait for the agent to finish executing the approved tool (spinner disappears)
      const working = page.getByText(/Working on it/i).first();
      await working.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
      await working.waitFor({ state: 'hidden', timeout: 60000 }).catch(() => {});
      await hold(page, 2200);
      if (checkpointAfter) await saveCheckpoint(page, checkpointAfter);
      approved = true;
      break;
    }

    // If PermissionCard did not appear on attempt 0, retry once
    if (attempt === 0) {
      await page.waitForTimeout(1500);
    }
  }
  return approved;
}

export async function recordScene({ scene, noTitles = false, headless = false }) {
  // Dependency check: Scene 2's Third Year C + Prof. Meera Iyer
  const dep = JSON.parse(runMongoQuery(`
    const div = await db.collection('divisions').findOne({ code: 'TE-C' });
    const teacher = await db.collection('users').findOne({ email: 'meera.iyer@university.edu' }, { projection: { _id: 1 } });
    const quizCountBefore = await db.collection('quizzes').countDocuments();
    const attCountBefore = await db.collection('attendances').countDocuments();
    const auditCountBefore = await db.collection('agentauditlogs').countDocuments();
    console.log(JSON.stringify({
      hasDiv: Boolean(div),
      hasTeacher: Boolean(teacher),
      quizCountBefore,
      attCountBefore,
      auditCountBefore,
    }));
  `));
  if (!dep.hasDiv || !dep.hasTeacher) {
    throw new Error('Scene 5 dependency missing: run Scene 2 first to create Third Year C and Prof. Meera Iyer.');
  }

  ensureDir(RAW_DIR);
  ensureDir(SCENES_DIR);
  const checkpoints = [];
  const cpPath = (name) => path.join(path.dirname(SCENES_DIR), 'checkpoints', `${name}.png`);

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    recordVideo: { dir: RAW_DIR, size: VIEWPORT },
  });
  await installCursor(context);

  const page = await context.newPage();
  const video = page.video();

  // 1. Title card (explicitly shows active Gemini model name)
  await showTitleCard(page, {
    number: scene.id,
    title: 'Autonomous AI Agent & Human-in-the-Loop Approvals',
    subtitle: `Live Tool Calling (${ACTIVE_MODEL}) · PermissionCard Gate · Dry-Run Alerts · Redacted Audit Logs`,
    durationMs: 2500,
    enabled: !noTitles,
  });

  // 2. Log in as Prof. Meera Iyer -> open Chat Interface
  await loginViaUI(page, APP_URL, 'meera.iyer@university.edu', 'Password123');
  await smoothClick(page, page.getByRole('link', { name: 'Chat Interface' }).first(), { holdAfterMs: 600 });
  await page.waitForURL('**/chat-interface', { timeout: 15000 });
  await hold(page, 1400);

  // Start a fresh chat session so prior turns do not interfere
  const newBtn = page.getByRole('button', { name: /\+ New/i }).first();
  if (await newBtn.isVisible().catch(() => false)) {
    await smoothClick(page, newBtn, { holdAfterMs: 500 });
  }

  // 3a. Prompt 1: Explicit 5-question MCQ quiz prompt (no ambiguity)
  const promptQuiz = 'Create a 5-question multiple-choice quiz on binary search trees for Third Year C, subject CS-311 Data Structures, 2 marks each, 10 minutes.';
  const quizApproved = await sendPromptAndApprove(page, promptQuiz, {
    checkpointCard: 's05-01a-permission-quiz',
    checkpointAfter: 's05-01a-quiz-done',
  });
  checkpoints.push(cpPath('s05-01a-permission-quiz'));

  // Open Quizzes page to show the newly created quiz
  await smoothClick(page, page.getByRole('link', { name: 'Quizzes' }).first(), { holdAfterMs: 600 });
  await page.waitForURL('**/quizzes', { timeout: 15000 });
  await hold(page, 2000);

  // Switch to mongo-express -> show new quiz document
  await openMongoExpress(page, 'quizzes');
  await hold(page, 2200);
  checkpoints.push(await saveCheckpoint(page, 's05-02-mongo-quizzes'));

  // 3b. Prompt 2: Mark Kabir Joshi absent for today's CS-311 lecture (fresh session)
  await page.goto(`${APP_URL}/chat-interface`, { waitUntil: 'networkidle' });
  await hold(page, 1000);
  if (await newBtn.isVisible().catch(() => false)) {
    await smoothClick(page, newBtn, { holdAfterMs: 500 });
  }
  const promptAtt = "Mark Kabir Joshi absent for today's CS-311 lecture in Third Year C.";
  const attApproved = await sendPromptAndApprove(page, promptAtt, {
    checkpointCard: 's05-01b-permission-attendance',
    checkpointAfter: 's05-01b-attendance-done',
  });
  checkpoints.push(cpPath('s05-01b-permission-attendance'));

  // Switch to mongo-express -> show attendance record
  await openMongoExpress(page, 'attendances');
  await hold(page, 2000);
  checkpoints.push(await saveCheckpoint(page, 's05-02b-mongo-attendance'));

  // 3c. WhatsApp reminder to defaulters in dry-run mode with DEMO MODE caption
  const postStats = JSON.parse(runMongoQuery(`
    const quizCountAfter = await db.collection('quizzes').countDocuments();
    const attCountAfter = await db.collection('attendances').countDocuments();
    const auditCountAfter = await db.collection('agentauditlogs').countDocuments();
    console.log(JSON.stringify({ quizCountAfter, attCountAfter, auditCountAfter }));
  `));

  await showOverlay(page, {
    badge: 'DEMO MODE',
    title: 'WhatsApp Defaulter Reminder — Dry-Run Mode Active',
    subtitle: `Active LLM: ${ACTIVE_MODEL} · WHATSAPP_DRY_RUN=true & VAPI_DRY_RUN=true · Nothing real sent`,
    content: JSON.stringify(
      {
        mode: 'DRY_RUN (DEMO MODE)',
        activeModel: ACTIVE_MODEL,
        tool: 'send_whatsapp_message',
        division: 'Third Year C (TE-C)',
        recipient: '[REDACTED_DEMO_RECIPIENT]',
        message: 'Attendance reminder: Please maintain >= 75% attendance for upcoming assessments.',
        dispatchedExternally: false,
        verifiedDbChanges: {
          quizzesDelta: postStats.quizCountAfter - dep.quizCountBefore,
          attendancesDelta: postStats.attCountAfter - dep.attCountBefore,
          auditLogsDelta: postStats.auditCountAfter - dep.auditCountBefore,
        },
      },
      null,
      2,
    ),
    durationMs: 3200,
  });
  checkpoints.push(await saveCheckpoint(page, 's05-03-whatsapp-demo-mode'));

  // 3d. AgentAuditLog entries (redacted) in mongo-express
  await openMongoExpress(page, 'agentauditlogs');
  await hold(page, 2400);
  checkpoints.push(await saveCheckpoint(page, 's05-04-mongo-audit'));

  await context.close();
  await browser.close();

  const webmPath = await video.path();
  const mp4Path = path.join(SCENES_DIR, `${scene.slug}.mp4`);
  convertWebmToMp4(webmPath, mp4Path);
  const dur = probeDuration(mp4Path);
  console.log(`✅ Scene 05 recorded: ${mp4Path} (${dur.toFixed(2)}s)`);
  console.log(`   Model: ${ACTIVE_MODEL} | Quiz PermissionCard approved: ${quizApproved} | Attendance PermissionCard approved: ${attApproved}`);
  console.log(`   DB Deltas: quizzes +${postStats.quizCountAfter - dep.quizCountBefore}, attendances +${postStats.attCountAfter - dep.attCountBefore}, auditLogs +${postStats.auditCountAfter - dep.auditCountBefore}`);
  console.log(`   Checkpoints: ${checkpoints.join(', ')}`);
  return mp4Path;
}
