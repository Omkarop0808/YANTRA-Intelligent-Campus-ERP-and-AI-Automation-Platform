import React, { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, RefreshCw, Terminal } from 'lucide-react';
import { AppLayout } from '../components/layout/AppLayout';
import { apiRequest, ApiError } from '../lib/api';
import { toast } from 'react-toastify';
import type { TeacherUser } from '../lib/auth/types';

interface AuditLogEntry {
  _id: string;
  tool: string;
  threadId: string;
  approvalStatus: string;
  resultStatus: string;
  timestamp: string;
  userId?: { name: string; email: string };
  args: Record<string, unknown>;
}

export const Admin: React.FC = () => {
  const [teachers, setTeachers] = useState<TeacherUser[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [tData, aData] = await Promise.all([
        apiRequest<{ teachers: TeacherUser[] }>('/admin/teachers/pending'),
        apiRequest<{ logs: AuditLogEntry[] }>('/admin/agent-audit').catch(() => ({ logs: [] })),
      ]);
      setTeachers(tData.teachers);
      setAuditLogs(aData.logs);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load administration data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const act = async (id: string, action: 'approve' | 'reject') => {
    setBusy(b => ({ ...b, [id]: true }));
    try {
      await apiRequest(`/admin/teachers/${id}/${action}`, { method: 'POST' });
      setTeachers(prev => prev.filter(t => t._id !== id));
      toast.success(action === 'approve' ? 'Teacher approved' : 'Teacher rejected');
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Action failed';
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(b => ({ ...b, [id]: false }));
    }
  };

  return (
    <AppLayout
      background="#F8FAFC"
      pageIcon={<ShieldCheck size={18} />}
      pageTitle="Teacher Verifications"
      pageBreadcrumb="Administration"
      pageActions={
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <button className="btn btn-secondary btn-sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          <div className="status-pill info" style={{ fontSize: '0.75rem' }}>
            {teachers.length} Pending
          </div>
        </div>
      }
    >
      <div style={{ marginBottom: '1.5rem' }}>
        <p style={{ color: 'var(--text-muted)', margin: 0 }}>
          Review and approve new faculty registration requests before they can access teaching workspaces.
        </p>
      </div>

      {error && (
        <div className="status-pill danger" style={{ marginBottom: '1rem', textTransform: 'none' }}>
          {error}
        </div>
      )}

      <div style={{ backgroundColor: 'white', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table" style={{ minWidth: 720 }}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Branch</th>
                <th>Courses</th>
                <th className="right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</td></tr>
              ) : teachers.length === 0 ? (
                <tr><td colSpan={5} style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>No pending teacher accounts. All faculty registrations are up to date.</td></tr>
              ) : (
                teachers.map((t) => (
                  <tr key={t._id}>
                    <td className="strong">{t.name}</td>
                    <td className="num">{t.email}</td>
                    <td className="num">{t.branch}</td>
                    <td className="num">{(t.courses ?? []).join(', ') || '—'}</td>
                    <td className="right">
                      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                        <button
                          className="btn btn-danger btn-sm"
                          disabled={!!busy[t._id]}
                          onClick={() => void act(t._id, 'reject')}
                        >Reject</button>
                        <button
                          className="btn btn-primary btn-sm"
                          disabled={!!busy[t._id]}
                          onClick={() => void act(t._id, 'approve')}
                        >Approve</button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Agent Audit Log Section */}
      <div style={{ marginTop: '2.5rem', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Terminal size={18} style={{ color: 'var(--primary)' }} /> AI Agent Tool Execution Audit Trail
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', margin: '0.25rem 0 0' }}>
            Tamper-evident log of all autonomous tool invocations, approval status, and redacted parameters.
          </p>
        </div>
        <div className="status-pill info" style={{ fontSize: '0.75rem' }}>
          {auditLogs.length} Logged Actions
        </div>
      </div>

      <div style={{ backgroundColor: 'white', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table" style={{ minWidth: 720 }}>
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Tool Name</th>
                <th>Caller</th>
                <th>Approval</th>
                <th>Result</th>
                <th>Redacted Arguments</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading audit trail…</td></tr>
              ) : auditLogs.length === 0 ? (
                <tr><td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>No tool calls logged yet. Tool invocations will appear here in real-time.</td></tr>
              ) : (
                auditLogs.map((log) => (
                  <tr key={log._id}>
                    <td className="num" style={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                      {new Date(log.timestamp).toLocaleString()}
                    </td>
                    <td className="strong" style={{ color: 'var(--primary)', fontFamily: 'monospace' }}>
                      {log.tool}
                    </td>
                    <td className="num">
                      {log.userId ? log.userId.name : 'System / AI'}
                    </td>
                    <td>
                      <span className={`status-pill ${log.approvalStatus === 'approved' ? 'success' : log.approvalStatus === 'rejected' ? 'danger' : 'info'}`} style={{ fontSize: '0.7rem' }}>
                        {log.approvalStatus}
                      </span>
                    </td>
                    <td>
                      <span className={`status-pill ${log.resultStatus === 'success' ? 'success' : 'danger'}`} style={{ fontSize: '0.7rem' }}>
                        {log.resultStatus}
                      </span>
                    </td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.75rem', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {JSON.stringify(log.args)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AppLayout>
  );
};
