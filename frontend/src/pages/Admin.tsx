import React, { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, RefreshCw } from 'lucide-react';
import { AppLayout } from '../components/layout/AppLayout';
import { apiRequest, ApiError } from '../lib/api';
import { toast } from 'react-toastify';
import type { TeacherUser } from '../lib/auth/types';

export const Admin: React.FC = () => {
  const [teachers, setTeachers] = useState<TeacherUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest<{ teachers: TeacherUser[] }>('/admin/teachers/pending');
      setTeachers(data.teachers);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load pending teachers');
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
    </AppLayout>
  );
};
