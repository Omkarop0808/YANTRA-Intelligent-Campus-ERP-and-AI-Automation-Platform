/**
 * Client for student notice upload (multimodal OCR extraction via FastAPI)
 * and saving PersonalDeadlines via Express.
 */

import { apiRequest, getToken } from '../api';
import { AI_BASE } from '../automation/agentApi';
import {
  ALLOWED_NOTICE_EXTENSIONS,
  ALLOWED_NOTICE_MIME_TYPES,
  MAX_NOTICE_FILE_BYTES,
  NoticeUploadError,
  sanitizeProviderError,
  validateNoticeFile,
  type NoticeDeadlineType,
  type NoticeExtractionDraft,
  type SavedPersonalDeadline,
} from '../../components/dashboard/uploadNoticeState';

export {
  ALLOWED_NOTICE_EXTENSIONS,
  ALLOWED_NOTICE_MIME_TYPES,
  MAX_NOTICE_FILE_BYTES,
  NoticeUploadError,
  sanitizeProviderError,
  validateNoticeFile,
  type NoticeDeadlineType,
  type NoticeExtractionDraft,
  type SavedPersonalDeadline,
};

export interface SavePersonalDeadlinePayload {
  title: string;
  subject: string;
  type: NoticeDeadlineType;
  deadline: string;
  source?: string;
  confidence?: number;
  lowConfidenceFields?: string[];
}

export async function extractNoticeDeadline(file: File): Promise<NoticeExtractionDraft> {
  const check = validateNoticeFile(file);
  if (!check.ok) {
    throw new NoticeUploadError(check.code, check.message, check.code === 'FILE_TOO_LARGE' ? 413 : 415);
  }

  const form = new FormData();
  form.append('file', file, file.name);

  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${AI_BASE}/ingest/document`, {
      method: 'POST',
      headers,
      body: form,
    });
  } catch {
    throw new NoticeUploadError(
      'NETWORK',
      'Network error: could not reach the extraction service. Please check your connection and try again.',
      0,
    );
  }

  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    const detail = typeof json?.detail === 'string' ? json.detail : undefined;
    throw sanitizeProviderError(res.status, detail);
  }

  return (json ?? {}) as unknown as NoticeExtractionDraft;
}

export async function savePersonalDeadline(
  payload: SavePersonalDeadlinePayload,
): Promise<SavedPersonalDeadline> {
  const res = await apiRequest<{ deadline: SavedPersonalDeadline }>('/deadlines/personal', {
    method: 'POST',
    body: {
      ...payload,
      source: 'from notice',
    },
  });
  return res.deadline;
}
