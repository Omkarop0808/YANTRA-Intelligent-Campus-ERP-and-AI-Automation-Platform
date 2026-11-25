import React, { useCallback, useEffect, useState } from 'react';
import { Building2, BookOpen, Plus, RefreshCw } from 'lucide-react';
import { toast } from 'react-toastify';
import { AppLayout } from '../components/layout/AppLayout';
import {
  fetchAllDivisions,
  fetchSubjects,
  fetchBranches,
  fetchAcademicYears,
  createDivision,
  createSubject,
} from '../lib/erp/api';
import type { AcademicYear, Branch, Division, Subject } from '../lib/erp/types';
import { ApiError } from '../lib/api';

const YEARS = ['FE', 'SE', 'TE', 'BE'] as const;

const cardStyle: React.CSSProperties = {
  backgroundColor: 'white',
  border: '1px solid var(--border-color)',
  borderRadius: 'var(--radius-lg)',
  padding: '1.25rem',
  boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
};

const inputStyle: React.CSSProperties = {
  border: '1px solid var(--border-color)',
  borderRadius: 'var(--radius-md)',
  padding: '0.55rem 0.75rem',
  fontSize: '0.875rem',
  width: '100%',
  background: 'white',
  fontFamily: 'inherit',
  outline: 'none',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.75rem',
  fontWeight: 700,
  color: '#475569',
  textTransform: 'uppercase',
  letterSpacing: '0.4px',
  marginBottom: '0.35rem',
};

const refName = (v: Branch | AcademicYear | string | undefined): string => {
  if (!v) return '—';
  if (typeof v === 'string') return v;
  return 'name' in v ? `${v.code} · ${v.name}` : v.code;
};

export const AcademicSetup: React.FC = () => {
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [loading, setLoading] = useState(true);

  // Create Class form state
  const [className, setClassName] = useState('');
  const [classCode, setClassCode] = useState('');
  const [classYear, setClassYear] = useState<'FE' | 'SE' | 'TE' | 'BE'>('TE');
  const [branchId, setBranchId] = useState('');
  const [academicYearId, setAcademicYearId] = useState('');
  const [savingClass, setSavingClass] = useState(false);

  // Create Subject form state
  const [subjectCode, setSubjectCode] = useState('');
  const [subjectName, setSubjectName] = useState('');
  const [subjectDivisionId, setSubjectDivisionId] = useState('');
  const [credits, setCredits] = useState('3');
  const [savingSubject, setSavingSubject] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [divs, subs, brs, ayRes] = await Promise.all([
        fetchAllDivisions(),
        fetchSubjects(),
        fetchBranches(),
        fetchAcademicYears(),
      ]);
      setDivisions(divs);
      setSubjects(subs);
      setBranches(brs);
      setYears(ayRes.years);
      setBranchId((prev) => prev || brs[0]?._id || '');
      setAcademicYearId((prev) => prev || ayRes.current?._id || ayRes.years[0]?._id || '');
      setSubjectDivisionId((prev) => prev || divs[0]?._id || '');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to load academic setup data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreateClass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!className.trim() || !branchId || !academicYearId) {
      toast.error('Please fill in class name, branch, and academic year');
      return;
    }
    setSavingClass(true);
    try {
      const created = await createDivision({
        name: className.trim(),
        code: classCode.trim() || undefined,
        year: classYear,
        branch: branchId,
        academicYear: academicYearId,
      });
      toast.success(`Class "${created.name}" (${created.code}) created`);
      setClassName('');
      setClassCode('');
      setSubjectDivisionId(created._id);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to create class');
    } finally {
      setSavingClass(false);
    }
  };

  const handleCreateSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subjectCode.trim() || !subjectName.trim() || !subjectDivisionId) {
      toast.error('Please fill in subject code, name, and class');
      return;
    }
    setSavingSubject(true);
    try {
      const created = await createSubject({
        code: subjectCode.trim(),
        name: subjectName.trim(),
        division: subjectDivisionId,
        credits: Number(credits) || 3,
      });
      toast.success(`Subject "${created.code} · ${created.name}" created`);
      setSubjectCode('');
      setSubjectName('');
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to create subject');
    } finally {
      setSavingSubject(false);
    }
  };

  return (
    <AppLayout
      background="#F8FAFC"
      pageIcon={<Building2 size={18} />}
      pageTitle="Academic Setup"
      pageBreadcrumb="Administration"
      pageActions={
        <button className="btn btn-secondary btn-sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      }
    >
      <div style={{ marginBottom: '1.25rem' }}>
        <p style={{ color: 'var(--text-muted)', margin: 0 }}>
          Create classes (divisions) and subjects for the active academic year.
        </p>
      </div>

      {/* Forms Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
          gap: '1.25rem',
          marginBottom: '1.5rem',
        }}
      >
        {/* Create Class Form */}
        <section style={cardStyle} aria-label="Create Class">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
            <Building2 size={18} color="var(--primary)" />
            <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Create Class</h2>
          </div>

          <form onSubmit={handleCreateClass} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            <div>
              <label htmlFor="class-name" style={labelStyle}>Class Name</label>
              <input
                id="class-name"
                type="text"
                placeholder="e.g. Third Year C"
                value={className}
                onChange={(e) => setClassName(e.target.value)}
                required
                style={inputStyle}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label htmlFor="class-code" style={labelStyle}>Code (Optional)</label>
                <input
                  id="class-code"
                  type="text"
                  placeholder="e.g. TE-C"
                  value={classCode}
                  onChange={(e) => setClassCode(e.target.value)}
                  style={inputStyle}
                />
              </div>
              <div>
                <label htmlFor="class-year" style={labelStyle}>Year</label>
                <select
                  id="class-year"
                  value={classYear}
                  onChange={(e) => setClassYear(e.target.value as 'FE' | 'SE' | 'TE' | 'BE')}
                  style={inputStyle}
                >
                  {YEARS.map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label htmlFor="class-branch" style={labelStyle}>Branch</label>
                <select
                  id="class-branch"
                  value={branchId}
                  onChange={(e) => setBranchId(e.target.value)}
                  required
                  style={inputStyle}
                >
                  {branches.map((b) => (
                    <option key={b._id} value={b._id}>{b.code} · {b.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="class-ay" style={labelStyle}>Academic Year</label>
                <select
                  id="class-ay"
                  value={academicYearId}
                  onChange={(e) => setAcademicYearId(e.target.value)}
                  required
                  style={inputStyle}
                >
                  {years.map((ay) => (
                    <option key={ay._id} value={ay._id}>
                      {ay.code}{ay.isCurrent ? ' (Current)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              disabled={savingClass}
              style={{ alignSelf: 'flex-start', marginTop: '0.25rem' }}
            >
              <Plus size={15} /> {savingClass ? 'Creating…' : 'Create Class'}
            </button>
          </form>
        </section>

        {/* Create Subject Form */}
        <section style={cardStyle} aria-label="Create Subject">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
            <BookOpen size={18} color="var(--primary)" />
            <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Create Subject</h2>
          </div>

          <form onSubmit={handleCreateSubject} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '0.75rem' }}>
              <div>
                <label htmlFor="subject-code" style={labelStyle}>Subject Code</label>
                <input
                  id="subject-code"
                  type="text"
                  placeholder="e.g. CS-301"
                  value={subjectCode}
                  onChange={(e) => setSubjectCode(e.target.value)}
                  required
                  style={inputStyle}
                />
              </div>
              <div>
                <label htmlFor="subject-name" style={labelStyle}>Subject Name</label>
                <input
                  id="subject-name"
                  type="text"
                  placeholder="e.g. Data Structures"
                  value={subjectName}
                  onChange={(e) => setSubjectName(e.target.value)}
                  required
                  style={inputStyle}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0.75rem' }}>
              <div>
                <label htmlFor="subject-division" style={labelStyle}>Class / Division</label>
                <select
                  id="subject-division"
                  value={subjectDivisionId}
                  onChange={(e) => setSubjectDivisionId(e.target.value)}
                  required
                  style={inputStyle}
                >
                  {divisions.map((d) => (
                    <option key={d._id} value={d._id}>{d.code} · {d.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="subject-credits" style={labelStyle}>Credits</label>
                <input
                  id="subject-credits"
                  type="number"
                  min={0}
                  max={20}
                  value={credits}
                  onChange={(e) => setCredits(e.target.value)}
                  style={inputStyle}
                />
              </div>
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              disabled={savingSubject || divisions.length === 0}
              style={{ alignSelf: 'flex-start', marginTop: '0.25rem' }}
            >
              <Plus size={15} /> {savingSubject ? 'Creating…' : 'Create Subject'}
            </button>
          </form>
        </section>
      </div>

      {/* Existing Lists */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))',
          gap: '1.25rem',
        }}
      >
        <section style={{ ...cardStyle, padding: 0, overflow: 'hidden' }} aria-label="Existing Classes">
          <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700 }}>Existing Classes</h3>
            <span className="status-pill info" style={{ fontSize: '0.75rem' }}>{divisions.length} Classes</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Year</th>
                  <th>Branch</th>
                  <th>Academic Year</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={5} style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</td></tr>
                ) : divisions.length === 0 ? (
                  <tr><td colSpan={5} style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>No classes created yet.</td></tr>
                ) : (
                  divisions.map((d) => (
                    <tr key={d._id}>
                      <td className="strong">{d.code}</td>
                      <td>{d.name}</td>
                      <td>{d.year}</td>
                      <td>{refName(d.branch)}</td>
                      <td>{refName(d.academicYear)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section style={{ ...cardStyle, padding: 0, overflow: 'hidden' }} aria-label="Existing Subjects">
          <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700 }}>Existing Subjects</h3>
            <span className="status-pill info" style={{ fontSize: '0.75rem' }}>{subjects.length} Subjects</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Year</th>
                  <th>Branch</th>
                  <th>Credits</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={5} style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</td></tr>
                ) : subjects.length === 0 ? (
                  <tr><td colSpan={5} style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>No subjects created yet.</td></tr>
                ) : (
                  subjects.map((s) => (
                    <tr key={s._id}>
                      <td className="strong">{s.code}</td>
                      <td>{s.name}</td>
                      <td>{s.year}</td>
                      <td>{refName(s.branch)}</td>
                      <td>{s.credits}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </AppLayout>
  );
};
