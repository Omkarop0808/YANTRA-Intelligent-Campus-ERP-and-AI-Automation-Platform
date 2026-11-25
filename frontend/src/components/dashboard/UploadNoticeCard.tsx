/**
 * Student Dashboard "Upload notice" card.
 *
 * Flow:
 *   1. Student drops or selects a notice image (PNG/JPG/WEBP) or PDF (max 10 MB).
 *   2. Shows preview + "Extract deadline" button.
 *   3. Calls POST /python-app/ingest/document; shows editable review form with
 *      low_confidence_fields highlighted ("Please check").
 *   4. Only when the student clicks "Save deadline" does it POST /api/deadlines/personal
 *      with source "from notice" and notify the parent dashboard to update immediately.
 */

import React, { useEffect, useId, useReducer, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  Loader2,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import {
  extractNoticeDeadline,
  NoticeUploadError,
  savePersonalDeadline,
  validateNoticeFile,
  type NoticeDeadlineType,
  type SavedPersonalDeadline,
} from '../../lib/deadlines/api';
import {
  fromDateTimeLocalValue,
  INITIAL_UPLOAD_NOTICE_STATE,
  uploadNoticeReducer,
} from './uploadNoticeState';

interface UploadNoticeCardProps {
  onSaved: (deadline: SavedPersonalDeadline) => void;
}

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

const lowConfidenceBadgeStyle: React.CSSProperties = {
  backgroundColor: '#FEF3C7',
  color: '#92400E',
  padding: '0.12rem 0.45rem',
  borderRadius: '9999px',
  fontSize: '0.68rem',
  fontWeight: 700,
};

const labelStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  fontWeight: 600,
  color: '#334155',
};

const primaryBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '0.45rem',
  flex: 1,
  backgroundColor: 'var(--primary, #2563EB)',
  color: '#FFFFFF',
  border: 'none',
  borderRadius: 'var(--radius-md, 0.5rem)',
  padding: '0.55rem 0.9rem',
  fontSize: '0.84rem',
  fontWeight: 600,
  cursor: 'pointer',
};

const secondaryBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '0.35rem',
  backgroundColor: '#FFFFFF',
  color: '#334155',
  border: '1px solid var(--border-color, #E2E8F0)',
  borderRadius: 'var(--radius-md, 0.5rem)',
  padding: '0.5rem 0.8rem',
  fontSize: '0.78rem',
  fontWeight: 600,
  cursor: 'pointer',
};

export const UploadNoticeCard: React.FC<UploadNoticeCardProps> = ({ onSaved }) => {
  const [state, dispatch] = useReducer(uploadNoticeReducer, INITIAL_UPLOAD_NOTICE_STATE);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const baseId = useId();

  useEffect(() => {
    if (!selectedFile || !selectedFile.type.startsWith('image/')) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(selectedFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [selectedFile]);

  const handleFileChosen = (file: File | null | undefined) => {
    if (!file) return;
    const check = validateNoticeFile(file);
    if (!check.ok) {
      setSelectedFile(null);
      dispatch({ type: 'FILE_ERROR', message: check.message });
      return;
    }
    setSelectedFile(file);
    dispatch({
      type: 'SELECT_FILE',
      fileMeta: { name: file.name, size: file.size, type: file.type },
    });
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFileChosen(e.target.files?.[0]);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    handleFileChosen(e.dataTransfer.files?.[0]);
  };

  const handleDropzoneKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInputRef.current?.click();
    }
  };

  const handleReset = () => {
    setSelectedFile(null);
    dispatch({ type: 'RESET' });
  };

  const handleExtract = async () => {
    if (!selectedFile) return;
    dispatch({ type: 'START_EXTRACT' });
    try {
      const draft = await extractNoticeDeadline(selectedFile);
      dispatch({ type: 'EXTRACT_SUCCESS', draft });
    } catch (err) {
      const msg =
        err instanceof NoticeUploadError
          ? err.message
          : 'Could not extract deadline details. Please try again or enter manually.';
      dispatch({ type: 'EXTRACT_ERROR', message: msg });
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const subject = state.form.subject.trim();
    const title = state.form.title.trim();
    const isoDeadline = fromDateTimeLocalValue(state.form.deadlineLocal);

    if (!subject || !title || !isoDeadline) {
      dispatch({
        type: 'SAVE_ERROR',
        message: 'Please fill in subject, title, and a valid deadline before saving.',
      });
      return;
    }

    dispatch({ type: 'START_SAVE' });
    try {
      const created = await savePersonalDeadline({
        subject,
        title,
        type: state.form.type,
        deadline: isoDeadline,
        source: 'from notice',
        confidence: state.confidence,
        lowConfidenceFields: state.lowConfidenceFields,
      });
      dispatch({ type: 'SAVE_SUCCESS', deadline: created });
      onSaved(created);
    } catch {
      dispatch({
        type: 'SAVE_ERROR',
        message: 'Could not save this deadline right now. Please try again.',
      });
    }
  };

  const isLowConfidence = (field: string) =>
    state.lowConfidenceFields.includes(field.toLowerCase());

  const inputStyle = (field: string): React.CSSProperties => ({
    width: '100%',
    boxSizing: 'border-box',
    borderRadius: 'var(--radius-md, 0.5rem)',
    border: isLowConfidence(field) ? '1.5px solid #F59E0B' : '1px solid var(--border-color, #CBD5E1)',
    backgroundColor: isLowConfidence(field) ? '#FFFBEB' : '#FFFFFF',
    color: '#0F172A',
    padding: '0.5rem 0.65rem',
    fontSize: '0.84rem',
    outline: 'none',
  });

  return (
    <section className="card" aria-labelledby={`${baseId}-heading`}>
      <div className="card-header" style={{ marginBottom: '0.85rem', alignItems: 'flex-start' }}>
        <div>
          <h2 id={`${baseId}-heading`} className="card-title-lg">
            Upload notice
          </h2>
          <div className="card-subtitle">
            Extract deadlines from circular images or PDFs (PNG, JPG, WEBP, PDF · max 10 MB)
          </div>
        </div>
        {state.phase !== 'idle' && (
          <button
            type="button"
            onClick={handleReset}
            aria-label="Reset notice upload"
            style={{ ...secondaryBtnStyle, padding: '0.3rem 0.55rem', fontSize: '0.72rem' }}
          >
            <X size={13} /> Clear
          </button>
        )}
      </div>

      <input
        ref={fileInputRef}
        id={`${baseId}-file`}
        type="file"
        accept=".png,.jpg,.jpeg,.webp,.pdf,image/png,image/jpeg,image/webp,application/pdf"
        onChange={handleInputChange}
        style={{ display: 'none' }}
        aria-label="Choose notice file"
      />

      {/* IDLE: drag-and-drop or choose file */}
      {state.phase === 'idle' && (
        <div
          role="button"
          tabIndex={0}
          aria-label="Upload notice file by dragging and dropping or pressing Enter to browse"
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={handleDropzoneKeyDown}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem',
            borderRadius: 'var(--radius-md, 0.75rem)',
            border: isDragging ? '2px dashed var(--primary, #2563EB)' : '2px dashed #CBD5E1',
            backgroundColor: isDragging ? '#EFF6FF' : '#F8FAFC',
            padding: '1.25rem 1rem',
            textAlign: 'center',
            cursor: 'pointer',
            transition: 'all 150ms ease',
          }}
        >
          <div
            style={{
              width: '2.4rem',
              height: '2.4rem',
              borderRadius: '9999px',
              backgroundColor: '#E0E7FF',
              color: 'var(--primary, #2563EB)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Upload size={18} />
          </div>
          <div style={{ fontSize: '0.86rem', fontWeight: 600, color: '#1E293B' }}>
            Drop a notice here or click to choose file
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted, #64748B)' }}>
            PNG, JPG, WEBP, or PDF up to 10 MB
          </div>
        </div>
      )}

      {/* PREVIEW / EXTRACTING */}
      {(state.phase === 'preview' || state.phase === 'extracting') && state.fileMeta && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }} aria-live="polite">
          <div
            style={{
              borderRadius: 'var(--radius-md, 0.75rem)',
              border: '1px solid var(--border-color, #E2E8F0)',
              backgroundColor: '#F8FAFC',
              padding: '0.75rem',
            }}
          >
            {previewUrl ? (
              <img
                src={previewUrl}
                alt={`Preview of ${state.fileMeta.name}`}
                style={{
                  marginBottom: '0.5rem',
                  maxHeight: '12rem',
                  width: '100%',
                  borderRadius: '0.5rem',
                  border: '1px solid #E2E8F0',
                  backgroundColor: '#FFFFFF',
                  objectFit: 'contain',
                }}
              />
            ) : (
              <div
                style={{
                  marginBottom: '0.5rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  borderRadius: '0.5rem',
                  border: '1px solid #E2E8F0',
                  backgroundColor: '#FFFFFF',
                  padding: '0.65rem',
                  color: '#334155',
                }}
              >
                <FileText size={18} style={{ color: 'var(--primary, #2563EB)', flexShrink: 0 }} />
                <span style={{ fontSize: '0.84rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {state.fileMeta.name}
                </span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', fontSize: '0.74rem', color: '#475569' }}>
              <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {state.fileMeta.name}
              </span>
              <span style={{ flexShrink: 0 }}>{formatFileSize(state.fileMeta.size)}</span>
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            <button
              type="button"
              onClick={handleExtract}
              disabled={state.phase === 'extracting'}
              style={{ ...primaryBtnStyle, opacity: state.phase === 'extracting' ? 0.65 : 1 }}
            >
              {state.phase === 'extracting' ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  Extracting deadline...
                </>
              ) : (
                <>
                  <Sparkles size={15} />
                  Extract deadline
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={state.phase === 'extracting'}
              style={secondaryBtnStyle}
            >
              Change file
            </button>
          </div>
        </div>
      )}

      {/* ERROR */}
      {state.phase === 'error' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }} role="alert">
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.6rem',
              borderRadius: 'var(--radius-md, 0.5rem)',
              border: '1px solid #FECACA',
              backgroundColor: '#FEF2F2',
              padding: '0.75rem',
              fontSize: '0.82rem',
              color: '#991B1B',
            }}
          >
            <AlertCircle size={17} style={{ marginTop: 1, flexShrink: 0, color: '#DC2626' }} />
            <div>{state.errorMessage}</div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              style={primaryBtnStyle}
            >
              Choose another file
            </button>
            <button
              type="button"
              onClick={() => dispatch({ type: 'OPEN_MANUAL_ENTRY' })}
              style={secondaryBtnStyle}
            >
              Enter details manually
            </button>
          </div>
        </div>
      )}

      {/* REVIEW / SAVING */}
      {(state.phase === 'review' || state.phase === 'saving') && (
        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }} noValidate>
          {state.emptyExtraction ? (
            <div
              style={{
                borderRadius: 'var(--radius-md, 0.5rem)',
                border: '1px solid #FDE68A',
                backgroundColor: '#FFFBEB',
                padding: '0.6rem 0.75rem',
                fontSize: '0.76rem',
                color: '#92400E',
              }}
            >
              No deadline fields could be extracted automatically. Enter the details manually below and click Save deadline.
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '0.5rem',
                borderRadius: 'var(--radius-md, 0.5rem)',
                border: '1px solid #C7D2FE',
                backgroundColor: '#EEF2FF',
                padding: '0.55rem 0.75rem',
                fontSize: '0.74rem',
                color: '#312E81',
              }}
            >
              <span>Review and edit before saving. Nothing is saved until you click Save.</span>
              <span style={{ flexShrink: 0, fontWeight: 700 }}>
                {Math.round(state.confidence * 100)}% match
              </span>
            </div>
          )}

          {state.errorMessage && (
            <div
              role="alert"
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.5rem',
                borderRadius: 'var(--radius-md, 0.5rem)',
                border: '1px solid #FECACA',
                backgroundColor: '#FEF2F2',
                padding: '0.55rem 0.75rem',
                fontSize: '0.76rem',
                color: '#991B1B',
              }}
            >
              <AlertCircle size={15} style={{ marginTop: 1, flexShrink: 0, color: '#DC2626' }} />
              <span>{state.errorMessage}</span>
            </div>
          )}

          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
              <label htmlFor={`${baseId}-subject`} style={labelStyle}>
                Subject
              </label>
              {isLowConfidence('subject') && <span style={lowConfidenceBadgeStyle}>Please check</span>}
            </div>
            <input
              id={`${baseId}-subject`}
              type="text"
              required
              value={state.form.subject}
              onChange={(e) => dispatch({ type: 'UPDATE_FIELD', field: 'subject', value: e.target.value })}
              placeholder="e.g. CS-301 Data Structures"
              style={inputStyle('subject')}
            />
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
              <label htmlFor={`${baseId}-title`} style={labelStyle}>
                Title
              </label>
              {isLowConfidence('title') && <span style={lowConfidenceBadgeStyle}>Please check</span>}
            </div>
            <input
              id={`${baseId}-title`}
              type="text"
              required
              value={state.form.title}
              onChange={(e) => dispatch({ type: 'UPDATE_FIELD', field: 'title', value: e.target.value })}
              placeholder="e.g. BST Lab Assignment Submission"
              style={inputStyle('title')}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.65rem' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                <label htmlFor={`${baseId}-type`} style={labelStyle}>
                  Type
                </label>
                {isLowConfidence('type') && <span style={lowConfidenceBadgeStyle}>Please check</span>}
              </div>
              <select
                id={`${baseId}-type`}
                value={state.form.type}
                onChange={(e) =>
                  dispatch({
                    type: 'UPDATE_FIELD',
                    field: 'type',
                    value: e.target.value as NoticeDeadlineType,
                  })
                }
                style={inputStyle('type')}
              >
                <option value="assignment">Assignment</option>
                <option value="exam">Exam</option>
                <option value="project">Project</option>
                <option value="notice">Notice</option>
              </select>
            </div>

            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                <label htmlFor={`${baseId}-deadline`} style={labelStyle}>
                  Deadline
                </label>
                {isLowConfidence('deadline') && <span style={lowConfidenceBadgeStyle}>Please check</span>}
              </div>
              <input
                id={`${baseId}-deadline`}
                type="datetime-local"
                required
                value={state.form.deadlineLocal}
                onChange={(e) =>
                  dispatch({ type: 'UPDATE_FIELD', field: 'deadlineLocal', value: e.target.value })
                }
                style={inputStyle('deadline')}
              />
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', paddingTop: '0.2rem' }}>
            <button
              type="submit"
              disabled={state.phase === 'saving'}
              style={{
                ...primaryBtnStyle,
                backgroundColor: '#059669',
                opacity: state.phase === 'saving' ? 0.65 : 1,
              }}
            >
              {state.phase === 'saving' ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  Saving...
                </>
              ) : (
                'Save deadline'
              )}
            </button>
            <button
              type="button"
              onClick={handleReset}
              disabled={state.phase === 'saving'}
              style={secondaryBtnStyle}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* SAVED */}
      {state.phase === 'saved' && state.savedDeadline && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }} aria-live="polite">
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.6rem',
              borderRadius: 'var(--radius-md, 0.5rem)',
              border: '1px solid #A7F3D0',
              backgroundColor: '#ECFDF5',
              padding: '0.75rem',
              fontSize: '0.82rem',
              color: '#065F46',
            }}
          >
            <CheckCircle2 size={18} style={{ marginTop: 1, flexShrink: 0, color: '#059669' }} />
            <div>
              <div style={{ fontWeight: 700 }}>Deadline saved</div>
              <div style={{ marginTop: '0.2rem', fontSize: '0.76rem', color: '#047857' }}>
                “{state.savedDeadline.title}” added to Upcoming Deadlines with the{' '}
                <span
                  style={{
                    display: 'inline-block',
                    backgroundColor: '#A7F3D0',
                    color: '#064E3B',
                    padding: '0.08rem 0.4rem',
                    borderRadius: '9999px',
                    fontWeight: 700,
                  }}
                >
                  from notice
                </span>{' '}
                badge.
              </div>
            </div>
          </div>
          <button type="button" onClick={handleReset} style={{ ...secondaryBtnStyle, width: '100%' }}>
            Upload another notice
          </button>
        </div>
      )}
    </section>
  );
};
