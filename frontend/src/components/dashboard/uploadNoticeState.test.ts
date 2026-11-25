import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fromDateTimeLocalValue,
  INITIAL_UPLOAD_NOTICE_STATE,
  MAX_NOTICE_FILE_BYTES,
  sanitizeProviderError,
  toDateTimeLocalValue,
  uploadNoticeReducer,
  validateNoticeFile,
} from './uploadNoticeState.ts';

test('state machine transitions: idle -> preview -> extracting -> review -> saving -> saved', () => {
  let state = INITIAL_UPLOAD_NOTICE_STATE;
  assert.equal(state.phase, 'idle');

  // 1. Select valid file -> preview
  state = uploadNoticeReducer(state, {
    type: 'SELECT_FILE',
    fileMeta: { name: 'notice.png', size: 120_000, type: 'image/png' },
  });
  assert.equal(state.phase, 'preview');
  assert.equal(state.fileMeta?.name, 'notice.png');

  // 2. Click extract -> extracting
  state = uploadNoticeReducer(state, { type: 'START_EXTRACT' });
  assert.equal(state.phase, 'extracting');

  // 3. Extraction returns draft with low_confidence_fields -> review (nothing saved yet)
  state = uploadNoticeReducer(state, {
    type: 'EXTRACT_SUCCESS',
    draft: {
      subject: 'CS-301 Data Structures',
      title: 'Binary Search Tree Lab',
      type: 'assignment',
      deadline: '2026-12-15T23:59:00Z',
      confidence: 0.72,
      low_confidence_fields: ['deadline'],
      source_filename: 'notice.png',
    },
  });
  assert.equal(state.phase, 'review');
  assert.equal(state.emptyExtraction, false);
  assert.equal(state.savedDeadline, null);
  assert.deepEqual(state.lowConfidenceFields, ['deadline']);
  assert.equal(state.form.subject, 'CS-301 Data Structures');
  assert.equal(state.form.title, 'Binary Search Tree Lab');
  assert.equal(state.form.type, 'assignment');
  assert.ok(state.form.deadlineLocal.length > 0);

  // 4. Student edits title in review form
  state = uploadNoticeReducer(state, {
    type: 'UPDATE_FIELD',
    field: 'title',
    value: 'BST Lab Assignment (Edited)',
  });
  assert.equal(state.form.title, 'BST Lab Assignment (Edited)');

  // 5. Click Save -> saving -> saved
  state = uploadNoticeReducer(state, { type: 'START_SAVE' });
  assert.equal(state.phase, 'saving');

  const iso = fromDateTimeLocalValue(state.form.deadlineLocal)!;
  state = uploadNoticeReducer(state, {
    type: 'SAVE_SUCCESS',
    deadline: {
      _id: '6b0555ed8a3c4c7142af033d',
      student: '6b0527016bce4d86d40677b2',
      title: state.form.title,
      subject: state.form.subject,
      type: state.form.type,
      deadline: iso,
      source: 'from notice',
      confidence: 0.72,
      lowConfidenceFields: ['deadline'],
    },
  });
  assert.equal(state.phase, 'saved');
  assert.equal(state.savedDeadline?.source, 'from notice');
  assert.equal(state.savedDeadline?.title, 'BST Lab Assignment (Edited)');

  // 6. Reset returns to idle
  state = uploadNoticeReducer(state, { type: 'RESET' });
  assert.equal(state.phase, 'idle');
});

test('empty extraction opens manual entry in review state', () => {
  let state = uploadNoticeReducer(INITIAL_UPLOAD_NOTICE_STATE, {
    type: 'SELECT_FILE',
    fileMeta: { name: 'blank.png', size: 1024, type: 'image/png' },
  });
  state = uploadNoticeReducer(state, { type: 'START_EXTRACT' });
  state = uploadNoticeReducer(state, {
    type: 'EXTRACT_SUCCESS',
    draft: { subject: '', title: '', deadline: '' },
  });
  assert.equal(state.phase, 'review');
  assert.equal(state.emptyExtraction, true);
  assert.deepEqual(state.lowConfidenceFields, ['subject', 'title', 'deadline']);
});

test('error state and manual entry fallback', () => {
  let state = uploadNoticeReducer(INITIAL_UPLOAD_NOTICE_STATE, {
    type: 'SELECT_FILE',
    fileMeta: { name: 'notice.pdf', size: 5000, type: 'application/pdf' },
  });
  state = uploadNoticeReducer(state, { type: 'START_EXTRACT' });
  state = uploadNoticeReducer(state, {
    type: 'EXTRACT_ERROR',
    message: 'The AI service is busy, try again in a moment.',
  });
  assert.equal(state.phase, 'error');
  assert.equal(state.errorMessage, 'The AI service is busy, try again in a moment.');

  state = uploadNoticeReducer(state, { type: 'OPEN_MANUAL_ENTRY' });
  assert.equal(state.phase, 'review');
  assert.equal(state.emptyExtraction, true);
});

test('file validation rejects unsupported types and oversized files', () => {
  const badType = validateNoticeFile({ name: 'notes.exe', type: 'application/octet-stream', size: 1024 });
  assert.equal(badType.ok, false);
  if (!badType.ok) assert.equal(badType.code, 'UNSUPPORTED_TYPE');

  const tooBig = validateNoticeFile({
    name: 'huge.pdf',
    type: 'application/pdf',
    size: MAX_NOTICE_FILE_BYTES + 1,
  });
  assert.equal(tooBig.ok, false);
  if (!tooBig.ok) assert.equal(tooBig.code, 'FILE_TOO_LARGE');

  const goodPng = validateNoticeFile({ name: 'notice.png', type: 'image/png', size: 40_000 });
  assert.equal(goodPng.ok, true);

  const goodPdf = validateNoticeFile({ name: 'circular.pdf', type: 'application/pdf', size: 40_000 });
  assert.equal(goodPdf.ok, true);
});

test('sanitizeProviderError hides raw Gemini quota errors and keys behind friendly 429 message', () => {
  const err = sanitizeProviderError(
    429,
    'google.genai.errors.ClientError: 429 RESOURCE_EXHAUSTED AIzaSySECRETKEY quota exceeded',
  );
  assert.equal(err.code, 'RATE_LIMITED');
  assert.equal(err.status, 429);
  assert.equal(err.message, 'The AI service is busy, try again in a moment.');
  assert.equal(err.message.includes('AIza'), false);
  assert.equal(err.message.includes('RESOURCE_EXHAUSTED'), false);
});

test('toDateTimeLocalValue and fromDateTimeLocalValue round-trip valid timestamps', () => {
  const local = toDateTimeLocalValue('2026-12-15T18:30:00.000Z');
  assert.match(local, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  const back = fromDateTimeLocalValue(local);
  assert.ok(back && back.endsWith('Z'));
  assert.equal(toDateTimeLocalValue('not-a-date'), '');
  assert.equal(fromDateTimeLocalValue(''), null);
});
