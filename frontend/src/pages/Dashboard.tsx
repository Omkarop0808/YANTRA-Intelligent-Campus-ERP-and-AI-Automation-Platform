import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ShieldCheck, Users, GraduationCap, BookOpen, Calendar, ClipboardList,
  FolderOpen, RefreshCw, CheckCircle2, XCircle, ArrowRight, Loader2,
} from 'lucide-react';
import { AppLayout } from '../components/layout/AppLayout';
import { TeacherDashboard } from './TeacherDashboard';
import { StudentDashboard } from './StudentDashboard';
import { ParentDashboard } from './ParentDashboard';
import { useRole } from '../lib/useRole';
import { useAuth } from '../lib/auth/AuthContext';
import { apiRequest, ApiError } from '../lib/api';
import { toast } from 'react-toastify';
import type { TeacherUser } from '../lib/auth/types';

interface AdminOverviewData {
  counts: {
    students: number;
    activeTeachers: number;
    pendingTeachers: number;
    divisions: number;
    subjects: number;
    lectures: number;
    schedules: number;
    quizzes: number;
    resources: number;
    submissions: number;
  };
  pendingTeachers: TeacherUser[];
  divisions: Array<{ _id: string; code: string; name: string; year?: string; studentCount: number }>;
  recentUsers: Array<{ _id: string; name: string; email: string; role: string; status: string; createdAt?: string }>;
}

const AdminDashboard: React.FC = () => {
  const { user } = useAuth();
  const [data, setData] = useState<AdminOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<AdminOverviewData>('/admin/overview');
      setData(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load admin overview');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleTeacherAction = async (id: string, action: 'approve' | 'reject') => {
    setBusy(prev => ({ ...prev, [id]: true }));
    try {
      await apiRequest(`/admin/teachers/${id}/${action}`, { method: 'POST' });
      toast.success(action === 'approve' ? 'Teacher account approved' : 'Teacher account rejected');
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Action failed');
    } finally {
      setBusy(prev => ({ ...prev, [id]: false }));
    }
  };

  const counts = data?.counts;
  const adminName = user?.name || 'Admin Console';

  return (
    <AppLayout
      background="#F8FAFC"
      pageIcon={<ShieldCheck size={18} />}
      pageTitle="Admin Overview"
      pageBreadcrumb="Institution Control Center"
      pageActions={
        <button className="btn btn-secondary btn-sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      }
    >
      {/* Hero Banner */}
      <div style={{
        marginBottom: '1.5rem',
        background: 'linear-gradient(120deg, #0F172A 0%, #1E3A8A 100%)',
        borderRadius: 'var(--radius-lg)',
        padding: '1.5rem 1.75rem',
        color: 'white',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '1.5rem',
        flexWrap: 'wrap',
        boxShadow: '0 10px 30px -10px rgba(15, 23, 42, 0.45)',
      }}>
        <div>
          <div style={{ fontSize: '0.7rem', fontWeight: 800, letterSpacing: '0.8px', color: '#93C5FD', textTransform: 'uppercase' }}>
            Yantra ERP · Institutional Administration
          </div>
          <h1 style={{ fontSize: '1.65rem', fontWeight: 800, margin: '0.35rem 0 0.25rem', color: 'white' }}>
            Welcome, {adminName}
          </h1>
          <p style={{ margin: 0, fontSize: '0.88rem', color: '#CBD5E1' }}>
            Monitor campus enrollment, verify faculty accounts, and manage schedules, quizzes, and AI automation across all divisions.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <Link to="/admin" className="btn btn-primary" style={{ textDecoration: 'none' }}>
            <ShieldCheck size={15} /> Teacher Verifications ({counts?.pendingTeachers ?? 0})
          </Link>
          <Link to="/chat-interface" className="btn btn-secondary" style={{ textDecoration: 'none' }}>
            AI Co-Pilot <ArrowRight size={14} />
          </Link>
        </div>
      </div>

      {error && (
        <div className="status-pill danger" style={{ marginBottom: '1rem', textTransform: 'none' }}>
          {error}
        </div>
      )}

      {/* KPI Strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        {[
          { label: 'Total Students', value: counts?.students, icon: <GraduationCap size={18} />, tone: '#2563EB', bg: '#EFF6FF', to: '/attendance/students' },
          { label: 'Active Teachers', value: counts?.activeTeachers, icon: <Users size={18} />, tone: '#16A34A', bg: '#F0FDF4', to: '/admin' },
          { label: 'Pending Approvals', value: counts?.pendingTeachers, icon: <ShieldCheck size={18} />, tone: '#D97706', bg: '#FFFBEB', to: '/admin' },
          { label: 'Divisions & Subjects', value: counts ? `${counts.divisions} / ${counts.subjects}` : undefined, icon: <BookOpen size={18} />, tone: '#7C3AED', bg: '#F5F3FF', to: '/attendance' },
          { label: 'Timetable Slots', value: counts?.schedules, icon: <Calendar size={18} />, tone: '#0284C7', bg: '#F0F9FF', to: '/attendance/schedules' },
          { label: 'Quizzes & Resources', value: counts ? `${counts.quizzes} / ${counts.resources}` : undefined, icon: <ClipboardList size={18} />, tone: '#DC2626', bg: '#FEF2F2', to: '/quizzes' },
        ].map((kpi) => (
          <Link
            key={kpi.label}
            to={kpi.to}
            style={{
              textDecoration: 'none',
              background: 'white',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-lg)',
              padding: '1.1rem 1.2rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
              boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                {kpi.label}
              </span>
              <span style={{ width: 32, height: 32, borderRadius: '0.5rem', background: kpi.bg, color: kpi.tone, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {kpi.icon}
              </span>
            </div>
            <div style={{ fontSize: '1.65rem', fontWeight: 800, color: '#0F172A' }}>
              {loading && kpi.value === undefined ? '—' : kpi.value ?? 0}
            </div>
          </Link>
        ))}
      </div>

      <div className="dashboard-grid">
        <div className="stack-lg">
          {/* Pending Teacher Verifications */}
          <div className="card">
            <div className="card-header">
              <div>
                <h2 className="card-title-lg">Pending Faculty Verifications</h2>
                <div className="card-subtitle">Approve or reject newly registered teacher accounts</div>
              </div>
              <Link to="/admin" className="alert-row-cta">Open Full Queue</Link>
            </div>

            {loading ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: '#64748B' }}>
                <Loader2 size={16} className="animate-spin" /> Loading institutional metrics…
              </div>
            ) : (data?.pendingTeachers.length ?? 0) === 0 ? (
              <div style={{ padding: '1.5rem', textAlign: 'center', color: '#15803D', background: '#F0FDF4', borderRadius: '0.5rem', fontWeight: 600, fontSize: '0.88rem' }}>
                All faculty accounts are verified. No pending approvals right now.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Branch</th>
                      <th className="right">Decision</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data!.pendingTeachers.map(t => (
                      <tr key={t._id}>
                        <td className="strong">{t.name}</td>
                        <td className="num">{t.email}</td>
                        <td className="num">{t.branch || '—'}</td>
                        <td className="right">
                          <div style={{ display: 'flex', gap: '0.45rem', justifyContent: 'flex-end' }}>
                            <button
                              className="btn btn-primary btn-sm"
                              disabled={!!busy[t._id]}
                              onClick={() => void handleTeacherAction(t._id, 'approve')}
                            >
                              <CheckCircle2 size={13} /> Approve
                            </button>
                            <button
                              className="btn btn-danger btn-sm"
                              disabled={!!busy[t._id]}
                              onClick={() => void handleTeacherAction(t._id, 'reject')}
                            >
                              <XCircle size={13} /> Reject
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Campus Divisions */}
          <div className="card">
            <div className="card-header">
              <div>
                <h2 className="card-title-lg">Active Academic Divisions</h2>
                <div className="card-subtitle">Live enrollment across configured campus divisions</div>
              </div>
              <Link to="/attendance" className="alert-row-cta">Attendance Overview</Link>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Division Code</th>
                    <th>Name</th>
                    <th className="right">Enrolled Students</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.divisions ?? []).map(div => (
                    <tr key={div._id}>
                      <td className="strong">{div.code}</td>
                      <td>{div.name}</td>
                      <td className="right num">{div.studentCount}</td>
                    </tr>
                  ))}
                  {!loading && (data?.divisions.length ?? 0) === 0 && (
                    <tr><td colSpan={3} style={{ textAlign: 'center', color: '#64748B', padding: '1.5rem' }}>No divisions configured yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="stack-lg">
          {/* Quick Module Links */}
          <div className="card">
            <h2 className="card-title-lg" style={{ marginBottom: '1rem' }}>Institution Modules</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {[
                { label: 'Campus Timetable & Schedules', sub: `${counts?.schedules ?? 0} recurring slots · ${counts?.lectures ?? 0} lectures`, to: '/attendance/schedules', icon: <Calendar size={16} /> },
                { label: 'Quiz Management & Analytics', sub: `${counts?.quizzes ?? 0} quizzes across divisions`, to: '/quizzes', icon: <ClipboardList size={16} /> },
                { label: 'Assignments & Notes Repository', sub: `${counts?.resources ?? 0} materials · ${counts?.submissions ?? 0} submissions`, to: '/assignments', icon: <FolderOpen size={16} /> },
                { label: 'Attendance Analytics & Reports', sub: 'At-risk student tracking & PDF exports', to: '/attendance/analytics', icon: <GraduationCap size={16} /> },
              ].map(item => (
                <Link
                  key={item.to}
                  to={item.to}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.85rem',
                    padding: '0.75rem 0.9rem', borderRadius: '0.55rem',
                    border: '1px solid var(--border-color)', textDecoration: 'none', color: 'inherit',
                  }}
                >
                  <div style={{ width: 34, height: 34, borderRadius: '0.45rem', background: '#EFF6FF', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {item.icon}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#0F172A' }}>{item.label}</div>
                    <div style={{ fontSize: '0.74rem', color: '#64748B' }}>{item.sub}</div>
                  </div>
                  <ArrowRight size={15} color="#94A3B8" />
                </Link>
              ))}
            </div>
          </div>

          {/* Recent Directory Activity */}
          <div className="card">
            <h2 className="card-title-lg" style={{ marginBottom: '1rem' }}>Recent User Directory</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
              {(data?.recentUsers ?? []).map(u => (
                <div key={u._id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '0.6rem', borderBottom: '1px solid #F1F5F9' }}>
                  <div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#0F172A' }}>{u.name}</div>
                    <div style={{ fontSize: '0.72rem', color: '#64748B' }}>{u.email}</div>
                  </div>
                  <span className={`status-pill ${u.role === 'admin' ? 'info' : u.role === 'teacher' ? 'warning' : 'success'}`} style={{ fontSize: '0.68rem' }}>
                    {u.role}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export const Dashboard: React.FC = () => {
  const { role } = useRole();
  if (role === 'teacher') return <TeacherDashboard />;
  if (role === 'student') return <StudentDashboard />;
  if (role === 'parent') return <ParentDashboard />;
  return <AdminDashboard />;
};
