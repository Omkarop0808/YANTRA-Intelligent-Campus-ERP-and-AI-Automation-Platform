/**
 * Pure finite state machine for the Student Dashboard "Upload notice" card.
 *
 * States:
 *   idle -> preview -> extracting -> review -> saving -> saved
 *                                 \-> error (with retry or manual entry)
 *
 * Nothing is persisted until the student explicitly clicks Save in `review`.
 */

export type NoticeDeadlineType = 'assignment' | 'exam' | 'notice' | 'project';

export const MAX_NOTICE_FILE_BYTES = 10 * 1024 * 1024; // 10 MB (matches FastAPI ingest.py)
export const ALLOWED_NOTICE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'application/pdf',
] as const;
export const ALLOWED_NOTICE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.pdf'] as const;

export interface NoticeExtractionDraft {
  subject: string;
  title: string;
  type: NoticeDeadlineType;
  deadline: string;
  confidence: number;
  low_confidence_fields: string[];
  source_filename: string;
}

export interface SavedPersonalDeadline {
  _id: string;
  student: string;
  title: string;
  subject: string;
  type: NoticeDeadlineType;
  deadline: string;
  source: string;
  confidence: number;
  lowConfidenceFields: string[];
  createdAt?: string;
  updatedAt?: string;
}

export class NoticeUploadError extends Error {
  status: number;
  code: 'UNSUPPORTED_TYPE' | 'FILE_TOO_LARGE' | 'RATE_LIMITED' | 'NETWORK' | 'SERVER';

  constructor(
    code: NoticeUploadError['code'],
    message: string,
    status = 0,
  ) {
    super(message);
    this.name = 'NoticeUploadError';
    this.code = code;
    this.status = status;
  }
}

export function validateNoticeFile(
  file: Pick<File, 'name' | 'type' | 'size'>,
): { ok: true } | { ok: false; code: 'UNSUPPORTED_TYPE' | 'FILE_TOO_LARGE'; message: string } {
  const lowerName = (file.name || '').toLowerCase();
  const hasAllowedExt = ALLOWED_NOTICE_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
  const hasAllowedMime = (ALLOWED_NOTICE_MIME_TYPES as readonly string[]).includes(
    (file.type || '').toLowerCase(),
  );

  if (!hasAllowedMime && !hasAllowedExt) {
    return {
      ok: false,
      code: 'UNSUPPORTED_TYPE',
      message: 'Unsupported file type. Please upload a PNG, JPG, WEBP, or PDF file.',
    };
  }

  if (file.size > MAX_NOTICE_FILE_BYTES) {
    return {
      ok: false,
      code: 'FILE_TOO_LARGE',
      message: 'File is too large. Maximum allowed size is 10 MB.',
    };
  }

  return { ok: true };
}

export function sanitizeProviderError(status: number, rawDetail?: string): NoticeUploadError {
  const lower = (rawDetail || '').toLowerCase();
  if (
    status === 429 ||
    lower.includes('resource_exhausted') ||
    lower.includes('quota') ||
    lower.includes('rate limit') ||
    lower.includes('too many requests')
  ) {
    return new NoticeUploadError(
      'RATE_LIMITED',
      'The AI service is busy, try again in a moment.',
      429,
    );
  }
  if (status === 415) {
    return new NoticeUploadError(
      'UNSUPPORTED_TYPE',
      'Unsupported file type. Please upload a PNG, JPG, WEBP, or PDF file.',
      415,
    );
  }
  if (status === 413) {
    return new NoticeUploadError(
      'FILE_TOO_LARGE',
      'File is too large. Maximum allowed size is 10 MB.',
      413,
    );
  }
  return new NoticeUploadError(
    'SERVER',
    'Could not extract deadline details from this file. You can try again or enter the details manually.',
    status,
  );
}

export type UploadNoticePhase =
  | 'idle'
  | 'preview'
  | 'extracting'
  | 'review'
  | 'saving'
  | 'saved'
  | 'error';

export interface NoticeReviewForm {
  subject: string;
  title: string;
  type: NoticeDeadlineType;
  /** Value bound to `<input type="datetime-local">` (`YYYY-MM-DDTHH:mm`). */
  deadlineLocal: string;
}

export interface NoticeFileMeta {
  name: string;
  size: number;
  type: string;
}

export interface UploadNoticeState {
  phase: UploadNoticePhase;
  fileMeta: NoticeFileMeta | null;
  form: NoticeReviewForm;
  confidence: number;
  lowConfidenceFields: string[];
  emptyExtraction: boolean;
  errorMessage: string | null;
  savedDeadline: SavedPersonalDeadline | null;
}

export type UploadNoticeAction =
  | { type: 'SELECT_FILE'; fileMeta: NoticeFileMeta }
  | { type: 'FILE_ERROR'; message: string }
  | { type: 'START_EXTRACT' }
  | { type: 'EXTRACT_SUCCESS'; draft: Partial<NoticeExtractionDraft> }
  | { type: 'EXTRACT_ERROR'; message: string }
  | { type: 'OPEN_MANUAL_ENTRY' }
  | { type: 'UPDATE_FIELD'; field: keyof NoticeReviewForm; value: string }
  | { type: 'START_SAVE' }
  | { type: 'SAVE_SUCCESS'; deadline: SavedPersonalDeadline }
  | { type: 'SAVE_ERROR'; message: string }
  | { type: 'RESET' };

const VALID_TYPES: readonly NoticeDeadlineType[] = ['assignment', 'exam', 'notice', 'project'];

export function toDateTimeLocalValue(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromDateTimeLocalValue(localValue: string): string | null {
  if (!localValue || !localValue.trim()) return null;
  const d = new Date(localValue);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function isDraftEmpty(draft?: Partial<NoticeExtractionDraft> | null): boolean {
  if (!draft) return true;
  const hasTitle = Boolean(draft.title && draft.title.trim());
  const hasSubject = Boolean(draft.subject && draft.subject.trim());
  const hasDeadline = Boolean(draft.deadline && toDateTimeLocalValue(draft.deadline));
  return !hasTitle && !hasSubject && !hasDeadline;
}

export const INITIAL_UPLOAD_NOTICE_STATE: UploadNoticeState = {
  phase: 'idle',
  fileMeta: null,
  form: {
    subject: '',
    title: '',
    type: 'notice',
    deadlineLocal: '',
  },
  confidence: 1,
  lowConfidenceFields: [],
  emptyExtraction: false,
  errorMessage: null,
  savedDeadline: null,
};

export function uploadNoticeReducer(
  state: UploadNoticeState,
  action: UploadNoticeAction,
): UploadNoticeState {
  switch (action.type) {
    case 'SELECT_FILE':
      return {
        ...INITIAL_UPLOAD_NOTICE_STATE,
        phase: 'preview',
        fileMeta: action.fileMeta,
      };

    case 'FILE_ERROR':
      return {
        ...INITIAL_UPLOAD_NOTICE_STATE,
        phase: 'error',
        errorMessage: action.message,
      };

    case 'START_EXTRACT':
      if (!state.fileMeta) return state;
      return {
        ...state,
        phase: 'extracting',
        errorMessage: null,
      };

    case 'EXTRACT_SUCCESS': {
      const draft = action.draft || {};
      const empty = isDraftEmpty(draft);
      const safeType: NoticeDeadlineType = VALID_TYPES.includes(draft.type as NoticeDeadlineType)
        ? (draft.type as NoticeDeadlineType)
        : 'notice';
      const lowFields = Array.isArray(draft.low_confidence_fields)
        ? draft.low_confidence_fields.map((f) => String(f).toLowerCase())
        : [];
      return {
        ...state,
        phase: 'review',
        emptyExtraction: empty,
        errorMessage: null,
        confidence: typeof draft.confidence === 'number' ? draft.confidence : (empty ? 0 : 1),
        lowConfidenceFields: empty ? ['subject', 'title', 'deadline'] : lowFields,
        form: {
          subject: (draft.subject || '').trim(),
          title: (draft.title || '').trim(),
          type: safeType,
          deadlineLocal: toDateTimeLocalValue(draft.deadline),
        },
      };
    }

    case 'EXTRACT_ERROR':
      return {
        ...state,
        phase: 'error',
        errorMessage: action.message,
      };

    case 'OPEN_MANUAL_ENTRY':
      return {
        ...state,
        phase: 'review',
        emptyExtraction: true,
        errorMessage: null,
        confidence: 1,
        lowConfidenceFields: [],
        form: {
          subject: state.form.subject,
          title: state.form.title,
          type: state.form.type,
          deadlineLocal: state.form.deadlineLocal,
        },
      };

    case 'UPDATE_FIELD':
      return {
        ...state,
        errorMessage: null,
        form: {
          ...state.form,
          [action.field]: action.value,
        },
      };

    case 'START_SAVE':
      return {
        ...state,
        phase: 'saving',
        errorMessage: null,
      };

    case 'SAVE_SUCCESS':
      return {
        ...state,
        phase: 'saved',
        errorMessage: null,
        savedDeadline: action.deadline,
      };

    case 'SAVE_ERROR':
      return {
        ...state,
        phase: 'review',
        errorMessage: action.message,
      };

    case 'RESET':
      return INITIAL_UPLOAD_NOTICE_STATE;

    default:
      return state;
  }
}
