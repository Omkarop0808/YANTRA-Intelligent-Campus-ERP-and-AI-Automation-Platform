import React, { useEffect, useState } from 'react';
import {
  Users, CheckCircle2, AlertTriangle, Loader2
} from 'lucide-react';
import { AppLayout } from '../components/layout/AppLayout';
import { apiRequest, ApiError } from '../lib/api';

interface Child {
  _id: string;
  name: string;
  email: string;
  rollNumber?: string;
  year?: string;
  branch?: string;
  division?: { name?: string; code?: string };
}

interface ChildAttendance {
  overall: {
    total: number;
    attended: number;
    percentage: number;
    isDefaulter: boolean;
  };
  subjects: Array<{
    subjectCode: string;
    subjectName: string;
    total: number;
    attended: number;
    percentage: number;
  }>;
  recoveryPlan?: Array<{
    code: string;
    name: string;
    classesNeeded: number;
    isAchievable: boolean;
  }>;
}

export const ParentDashboard: React.FC = () => {
  const [children, setChildren] = useState<Child[]>([]);
  const [selectedChild, setSelectedChild] = useState<Child | null>(null);
  const [attendance, setAttendance] = useState<ChildAttendance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiRequest<{ children: Child[] }>('/parent/children')
      .then(res => {
        if (!cancelled) {
          setChildren(res.children || []);
          if (res.children && res.children.length > 0) {
            setSelectedChild(res.children[0]);
          }
        }
      })
      .catch(e => {
        if (!cancelled) {
          setError(e instanceof ApiError ? e.message : 'Failed to load children');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!selectedChild) return;
    let cancelled = false;
    apiRequest<ChildAttendance>(`/parent/children/${selectedChild._id}/attendance`)
      .then(res => {
        if (!cancelled) setAttendance(res);
      })
      .catch(e => {
        console.warn('Failed to fetch child attendance', e);
      });
    return () => { cancelled = true; };
  }, [selectedChild]);

  return (
    <AppLayout pageTitle="Parent Academic Portal">
      <div className="stack-lg">
        {/* Child Selector Header */}
        <div className="card" style={{ padding: '1.25rem 1.5rem', backgroundColor: '#F8FAFC' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
              <div style={{ width: 44, height: 44, borderRadius: '50%', backgroundColor: '#2563EB', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Users size={22} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.15rem' }}>
                  {selectedChild ? selectedChild.name : 'Registered Wards'}
                </h3>
                <p style={{ margin: 0, fontSize: '0.815rem', color: '#64748B' }}>
                  {selectedChild?.rollNumber ? `Roll No: ${selectedChild.rollNumber} • ` : ''}
                  {selectedChild?.division?.code ?? 'Division TE-A'} • {selectedChild?.branch ?? 'Computer Engineering'}
                </p>
              </div>
            </div>

            {children.length > 1 && (
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {children.map(c => (
                  <button
                    key={c._id}
                    className={`btn btn-sm ${selectedChild?._id === c._id ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setSelectedChild(c)}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
            <Loader2 className="animate-spin text-blue-600" size={32} />
          </div>
        ) : error ? (
          <div className="card" style={{ padding: '2rem', textAlign: 'center', color: '#EF4444' }}>
            {error}
          </div>
        ) : (
          <>
            {/* Overview Metric Banner */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.25rem' }}>
              <div className="card" style={{ padding: '1.5rem', borderLeft: `5px solid ${attendance?.overall?.isDefaulter ? '#EF4444' : '#10B981'}` }}>
                <span style={{ fontSize: '0.785rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase' }}>Overall Attendance</span>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', marginTop: '0.5rem' }}>
                  <span style={{ fontSize: '2.25rem', fontWeight: 800, color: attendance?.overall?.isDefaulter ? '#EF4444' : '#0F172A' }}>
                    {attendance?.overall?.percentage ?? 0}%
                  </span>
                  <span style={{ fontSize: '0.85rem', color: '#64748B' }}>
                    ({attendance?.overall?.attended ?? 0} / {attendance?.overall?.total ?? 0} classes)
                  </span>
                </div>
                {attendance?.overall?.isDefaulter ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.5rem', color: '#EF4444', fontSize: '0.815rem', fontWeight: 600 }}>
                    <AlertTriangle size={15} /> Below mandatory 75% threshold
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.5rem', color: '#10B981', fontSize: '0.815rem', fontWeight: 600 }}>
                    <CheckCircle2 size={15} /> Good standing
                  </div>
                )}
              </div>

              <div className="card" style={{ padding: '1.5rem' }}>
                <span style={{ fontSize: '0.785rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase' }}>Academic Recovery Status</span>
                <div style={{ marginTop: '0.5rem' }}>
                  {attendance?.recoveryPlan && attendance.recoveryPlan.some(p => p.classesNeeded > 0) ? (
                    <div>
                      <span style={{ fontSize: '1.15rem', fontWeight: 700, color: '#F59E0B' }}>Action Required</span>
                      <p style={{ margin: '0.25rem 0 0', fontSize: '0.815rem', color: '#475569' }}>
                        Must attend consecutive lectures in {attendance.recoveryPlan.filter(p => p.classesNeeded > 0).length} subjects to restore eligibility.
                      </p>
                    </div>
                  ) : (
                    <div>
                      <span style={{ fontSize: '1.15rem', fontWeight: 700, color: '#10B981' }}>On Track</span>
                      <p style={{ margin: '0.25rem 0 0', fontSize: '0.815rem', color: '#475569' }}>
                        No attendance recovery lectures currently required.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Subject Attendance Breakdown */}
            <div className="card">
              <div className="card-header">
                <h3>Course Attendance & Recovery Plan</h3>
                <span className="status-pill">{attendance?.subjects?.length ?? 0} Courses</span>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Course</th>
                      <th>Attended / Total</th>
                      <th>Attendance %</th>
                      <th>Classes Needed for 75%</th>
                      <th>Recovery Achievable</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attendance?.subjects?.map(s => {
                      const rec = attendance.recoveryPlan?.find(r => r.code === s.subjectCode);
                      const needed = rec?.classesNeeded ?? 0;
                      const achievable = rec?.isAchievable ?? true;
                      return (
                        <tr key={s.subjectCode}>
                          <td>
                            <span className="strong">{s.subjectName}</span>
                            <div style={{ fontSize: '0.75rem', color: '#64748B' }}>{s.subjectCode}</div>
                          </td>
                          <td className="num">{s.attended} / {s.total}</td>
                          <td>
                            <span style={{ fontWeight: 700, color: s.percentage < 75 ? '#EF4444' : '#10B981' }}>
                              {s.percentage}%
                            </span>
                          </td>
                          <td>
                            {needed > 0 ? (
                              <span style={{ color: '#F59E0B', fontWeight: 700 }}>{needed} lectures</span>
                            ) : (
                              <span style={{ color: '#10B981', fontWeight: 600 }}>0 (Eligible)</span>
                            )}
                          </td>
                          <td>
                            {needed > 0 ? (
                              achievable ? (
                                <span style={{ color: '#10B981', fontSize: '0.815rem', fontWeight: 600 }}>Yes (scheduled)</span>
                              ) : (
                                <span style={{ color: '#EF4444', fontSize: '0.815rem', fontWeight: 600 }}>Critically Short</span>
                              )
                            ) : (
                              <span style={{ color: '#64748B', fontSize: '0.815rem' }}>—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
};
