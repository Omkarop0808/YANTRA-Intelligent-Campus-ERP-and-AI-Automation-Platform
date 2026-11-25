import path from 'node:path';
import { chromium } from 'playwright';
import {
  API_URL,
  APP_URL,
  DEMO_CLASS,
  DEMO_SUBJECTS,
  RAW_DIR,
  SCENES_DIR,
  VIEWPORT,
} from '../lib/constants.mjs';
import {
  convertWebmToMp4,
  ensureDir,
  hold,
  humanType,
  installCursor,
  loginViaUI,
  logoutViaUI,
  openMongoExpress,
  probeDuration,
  queryCollectionCounts,
  runMongoQuery,
  saveCheckpoint,
  showCollectionDiffTable,
  showOverlay,
  showTitleCard,
  smoothClick,
} from '../lib/helpers.mjs';

const API_STUDENTS = [
  { name: 'Kabir Joshi', email: 'kabir.joshi@university.edu', rollNumber: 'TE-C-002' },
  { name: 'Ananya Kulkarni', email: 'ananya.kulkarni@university.edu', rollNumber: 'TE-C-003' },
  { name: 'Vikram Nair', email: 'vikram.nair@university.edu', rollNumber: 'TE-C-004' },
  { name: 'Sneha Patil', email: 'sneha.patil@university.edu', rollNumber: 'TE-C-005' },
];

export async function recordScene({ scene, noTitles = false, headless = false }) {
  // Precondition: Third Year C must not exist yet (prepare.sh ensures clean state)
  const preCheck = runMongoQuery(`
    const teC = await db.collection('divisions').findOne({ $or: [{ name: 'Third Year C' }, { code: 'TE-C' }] });
    console.log(JSON.stringify({ exists: teC !== null }));
  `);
  if (JSON.parse(preCheck).exists) {
    throw new Error('Scene 2 precondition failed: "Third Year C" already exists in yantra_demo. Run "bash demo-video/prepare.sh" first.');
  }

  ensureDir(RAW_DIR);
  ensureDir(SCENES_DIR);

  const beforeCounts = queryCollectionCounts();
  const checkpoints = [];

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    recordVideo: { dir: RAW_DIR, size: VIEWPORT },
  });
  await installCursor(context);

  const page = await context.newPage();
  const video = page.video();

  // 0. Title card
  await showTitleCard(page, {
    number: scene.id,
    title: 'Database & Set-Up From Scratch',
    subtitle: 'Creating Third Year C, 3 Subjects, Faculty Approval, 5 Students & Weekly Timetable in Live MongoDB',
    durationMs: 2500,
    enabled: !noTitles,
  });

  // 1. Show yantra_demo in mongo-express + captured base counts + attendances compound index
  await openMongoExpress(page);
  await hold(page, 2200);
  checkpoints.push(await saveCheckpoint(page, 's02-01-mongo-initial'));

  const attendanceIndexes = runMongoQuery(`
    const idxs = await db.collection('attendances').indexes();
    console.log(JSON.stringify(idxs.map(i => ({ name: i.name, key: i.key })), null, 2));
  `);
  await showOverlay(page, {
    badge: 'TERMINAL',
    title: 'Isolated Database Verification & Compound Indexes',
    subtitle: 'Real captured MongoDB queries on yantra_demo before setup',
    content: [
      '# 1. Base collection counts in yantra_demo (Third Year C does NOT exist):',
      JSON.stringify(beforeCounts, null, 2),
      '',
      '# 2. attendances collection indexes (note compound index division_1_subject_1_markedAt_-1):',
      attendanceIndexes,
    ].join('\n'),
    durationMs: 3200,
  });

  // 2a. Admin login -> Academic Setup -> Create Class "Third Year C"
  await loginViaUI(page, APP_URL, 'admin@university.edu', 'AdminPassword123!');
  await smoothClick(page, page.getByRole('link', { name: 'Academic Setup' }).first(), { holdAfterMs: 600 });
  await page.waitForURL('**/admin/academic-setup', { timeout: 15000 });
  await hold(page, 1200);

  await humanType(page, page.locator('#class-name'), DEMO_CLASS.name);
  await humanType(page, page.locator('#class-code'), DEMO_CLASS.code);
  await page.locator('#class-year').selectOption(DEMO_CLASS.year);
  await smoothClick(page, page.getByRole('button', { name: /Create Class/i }), { holdAfterMs: 1800 });
  checkpoints.push(await saveCheckpoint(page, 's02-02-class-created'));

  // Show new division document in mongo-express
  await openMongoExpress(page, 'divisions');
  await hold(page, 2200);
  checkpoints.push(await saveCheckpoint(page, 's02-03-mongo-divisions'));

  // 2b. Create 3 subjects (CS-311, CS-312, CS-313) in Academic Setup
  await page.goto(`${APP_URL}/admin/academic-setup`, { waitUntil: 'networkidle' });
  await hold(page, 800);

  // Select Third Year C in subject division dropdown
  const teCOption = await page.locator('#subject-division option', { hasText: 'TE-C' }).getAttribute('value');
  for (const sub of DEMO_SUBJECTS) {
    await humanType(page, page.locator('#subject-code'), sub.code, { delayMs: 55 });
    await humanType(page, page.locator('#subject-name'), sub.name, { delayMs: 55 });
    if (teCOption) await page.locator('#subject-division').selectOption(teCOption);
    await page.locator('#subject-credits').fill(String(sub.credits));
    await smoothClick(page, page.getByRole('button', { name: /Create Subject/i }), { holdAfterMs: 1500 });
  }
  checkpoints.push(await saveCheckpoint(page, 's02-04-subjects-created'));

  // Show new subject documents in mongo-express
  await openMongoExpress(page, 'subjects');
  await hold(page, 2200);

  // 2c. Register Teacher "Prof. Meera Iyer" at /signup, then approve in /admin
  await page.goto(`${APP_URL}/dashboard`, { waitUntil: 'networkidle' });
  await logoutViaUI(page);
  await page.goto(`${APP_URL}/signup`, { waitUntil: 'networkidle' });
  await smoothClick(page, page.locator('label', { hasText: /^teacher$/i }).first(), { holdAfterMs: 400 });

  await humanType(page, page.getByPlaceholder('Monica Hemsworth'), 'Prof. Meera Iyer', { delayMs: 55 });
  await humanType(page, page.getByPlaceholder('monica@university.edu'), 'meera.iyer@university.edu', { delayMs: 50 });
  await humanType(page, page.getByPlaceholder('••••••••'), 'Password123', { delayMs: 50 });
  await humanType(page, page.getByPlaceholder('Computer Science'), 'Computer Engineering', { delayMs: 50 });
  await humanType(page, page.getByPlaceholder('Dept. of CS'), 'Department of CS', { delayMs: 50 });
  await humanType(page, page.getByPlaceholder('CS-101, AI Algorithms'), 'CS-311, CS-312, CS-313', { delayMs: 50 });
  await humanType(page, page.getByPlaceholder('A, B'), 'Third Year C', { delayMs: 55 });
  await smoothClick(page, page.getByRole('button', { name: /Get Started/i }), { holdAfterMs: 600 });
  await page.waitForURL('**/pending-approval', { timeout: 15000 });
  await hold(page, 1800);

  // Admin approves Prof. Meera Iyer in /admin
  await loginViaUI(page, APP_URL, 'admin@university.edu', 'AdminPassword123!');
  await smoothClick(page, page.getByRole('link', { name: 'Teacher Verifications' }).first(), { holdAfterMs: 600 });
  await page.waitForURL('**/admin', { timeout: 15000 });
  await hold(page, 1200);
  const approveRow = page.locator('tr', { hasText: 'Prof. Meera Iyer' });
  await smoothClick(page, approveRow.getByRole('button', { name: /Approve/i }), { holdAfterMs: 1800 });
  checkpoints.push(await saveCheckpoint(page, 's02-05-teacher-approved'));

  // Show users count only in mongo-express database overview (never open users docs)
  await openMongoExpress(page);
  await hold(page, 1800);

  // 2d. Register 5 students into Third Year C: 1 in /signup UI + 4 via API overlay
  await page.goto(`${APP_URL}/dashboard`, { waitUntil: 'networkidle' });
  await logoutViaUI(page);
  await page.goto(`${APP_URL}/signup`, { waitUntil: 'networkidle' });
  await humanType(page, page.getByPlaceholder('Monica Hemsworth'), 'Riya Deshmukh', { delayMs: 55 });
  await humanType(page, page.getByPlaceholder('monica@university.edu'), 'riya.deshmukh@university.edu', { delayMs: 50 });
  await humanType(page, page.getByPlaceholder('••••••••'), 'Password123', { delayMs: 50 });
  await humanType(page, page.getByPlaceholder('Computer Engineering'), 'Computer Engineering', { delayMs: 50 });
  await page.locator('select').first().selectOption('TE');
  await humanType(page, page.getByPlaceholder('A', { exact: true }), 'Third Year C', { delayMs: 55 });
  await humanType(page, page.getByPlaceholder('2024-CS-089'), 'TE-C-001', { delayMs: 55 });
  await smoothClick(page, page.getByRole('button', { name: /Get Started/i }), { holdAfterMs: 600 });
  await page.waitForURL('**/dashboard', { timeout: 15000 });
  await hold(page, 1600);

  // Register remaining 4 students via POST /api/auth/register/student (captured live)
  const apiLog = [];
  for (const st of API_STUDENTS) {
    const res = await fetch(`${API_URL}/auth/register/student`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: st.name,
        email: st.email,
        password: 'Password123',
        branch: 'Computer Engineering',
        year: 'TE',
        division: 'Third Year C',
        rollNumber: st.rollNumber,
      }),
    });
    const body = await res.json();
    apiLog.push({
      endpoint: 'POST /api/auth/register/student',
      status: res.status,
      student: body.user?.name,
      rollNumber: body.user?.rollNumber,
      division: body.user?.division,
      divisionRef_linked: Boolean(body.user?.divisionRef),
      accountStatus: body.user?.status,
    });
  }

  // Query GET /api/academic/divisions/:id/students as admin to prove all 5 are returned
  const adminLoginRes = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@university.edu', password: 'AdminPassword123!' }),
  });
  const { token: adminToken } = await adminLoginRes.json();
  const divsRes = await fetch(`${API_URL}/academic/divisions`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const divsJson = await divsRes.json();
  const teCDiv = divsJson.divisions.find((d) => d.code === 'TE-C');
  const rosterRes = await fetch(`${API_URL}/academic/divisions/${teCDiv._id}/students`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const rosterJson = await rosterRes.json();

  await showOverlay(page, {
    badge: 'API',
    title: 'Student Registration (4 via API) & Relational Roster Verification',
    subtitle: 'Students auto-activate with divisionRef & branchRef resolved automatically',
    content: [
      '# 1. Batch registration via POST /api/auth/register/student:',
      JSON.stringify(apiLog, null, 2),
      '',
      `# 2. GET /api/academic/divisions/${teCDiv._id}/students -> HTTP ${rosterRes.status} (count: ${rosterJson.students.length}):`,
      JSON.stringify(
        rosterJson.students.map((s) => ({ rollNumber: s.rollNumber, name: s.name, division: s.division })),
        null,
        2,
      ),
    ].join('\n'),
    durationMs: 3600,
  });
  checkpoints.push(await saveCheckpoint(page, 's02-06-students-api'));

  // 2e. Teacher Prof. Meera Iyer adds weekly timetable slots (including today) + materialise today's lecture
  await page.goto(`${APP_URL}/dashboard`, { waitUntil: 'networkidle' });
  await logoutViaUI(page);
  await loginViaUI(page, APP_URL, 'meera.iyer@university.edu', 'Password123');
  await smoothClick(page, page.getByRole('link', { name: 'Schedule' }).first(), { holdAfterMs: 600 });
  await page.waitForURL('**/attendance/schedules', { timeout: 15000 });
  await hold(page, 1000);

  const jsDay = new Date().getDay();
  const todayIsoWeekday = jsDay === 0 ? 7 : jsDay;
  const secondIsoWeekday = todayIsoWeekday === 5 ? 1 : ((todayIsoWeekday % 5) + 1);

  const addSlot = async (subCode, weekday, startTime, endTime, room) => {
    await smoothClick(page, page.getByRole('button', { name: /Add Slot|Add your first slot/i }).first(), { holdAfterMs: 400 });
    const modal = page.locator('form.card');
    const divVal = await modal.locator('select').nth(0).locator('option', { hasText: 'TE-C' }).getAttribute('value');
    const subVal = await modal.locator('select').nth(1).locator('option', { hasText: subCode }).getAttribute('value');
    await modal.locator('select').nth(0).selectOption(divVal);
    await modal.locator('select').nth(1).selectOption(subVal);
    await modal.locator('select').nth(2).selectOption(String(weekday));
    await modal.locator('input[type="time"]').nth(0).fill(startTime);
    await modal.locator('input[type="time"]').nth(1).fill(endTime);
    await humanType(page, modal.getByPlaceholder('Lab 402'), room, { delayMs: 55 });
    await smoothClick(page, modal.getByRole('button', { name: /Add Slot/i }), { holdAfterMs: 1500 });
  };

  await addSlot('CS-311', todayIsoWeekday, '09:00', '10:00', 'Lab 405');
  await addSlot('CS-312', secondIsoWeekday, '10:15', '11:15', 'Hall 201');
  await hold(page, 1600);

  // Materialise today's lecture via API
  const todayStr = new Date().toISOString().slice(0, 10);
  const teacherLoginRes = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'meera.iyer@university.edu', password: 'Password123' }),
  });
  const { token: teacherToken } = await teacherLoginRes.json();
  const matRes = await fetch(`${API_URL}/schedules/materialise`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${teacherToken}` },
    body: JSON.stringify({ date: todayStr, divisionId: teCDiv._id }),
  });
  const matJson = await matRes.json();

  await showOverlay(page, {
    badge: 'API',
    title: 'Materialise Today\'s Lecture from Timetable',
    subtitle: `POST /api/schedules/materialise (${todayStr})`,
    content: JSON.stringify({ status: matRes.status, date: todayStr, response: matJson }, null, 2),
    durationMs: 2400,
  });

  // Show schedules & lectures in mongo-express
  await openMongoExpress(page, 'schedules');
  await hold(page, 1800);
  await openMongoExpress(page, 'lectures');
  await hold(page, 2000);
  checkpoints.push(await saveCheckpoint(page, 's02-07-mongo-lectures'));

  // Final before/after collection-count table from real Mongo queries
  const afterCounts = queryCollectionCounts();
  await showCollectionDiffTable(page, {
    title: 'Scene 2 Summary — Before vs. After Collection Counts',
    beforeCounts,
    afterCounts,
    durationMs: 4200,
  });
  checkpoints.push(await saveCheckpoint(page, 's02-08-before-after'));

  await context.close();
  await browser.close();

  const webmPath = await video.path();
  const mp4Path = path.join(SCENES_DIR, `${scene.slug}.mp4`);
  convertWebmToMp4(webmPath, mp4Path);
  const dur = probeDuration(mp4Path);
  console.log(`✅ Scene 02 recorded: ${mp4Path} (${dur.toFixed(2)}s)`);
  console.log(`   Checkpoints: ${checkpoints.join(', ')}`);
  return mp4Path;
}
