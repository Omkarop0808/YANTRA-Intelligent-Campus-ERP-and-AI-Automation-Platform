import { Branch, type BranchDoc } from '../models/Branch';
import { AcademicYear, type AcademicYearDoc } from '../models/AcademicYear';
import { Division, type DivisionDoc, type Year } from '../models/Division';
import { Subject, type SubjectDoc } from '../models/Subject';
import { Student, type StudentDoc } from '../models/Student';
import { Teacher, type TeacherDoc } from '../models/Teacher';
import { Types } from 'mongoose';
import { BadRequest, Conflict, NotFound } from '../utils/http-errors';
import type { CreateDivisionInput, CreateSubjectInput } from '../validators/academic.validator';

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const inferYearFromName = (name: string): Year => {
  if (/\b(first|fe)\b/i.test(name)) return 'FE';
  if (/\b(second|se)\b/i.test(name)) return 'SE';
  if (/\b(third|te)\b/i.test(name)) return 'TE';
  if (/\b(fourth|final|be)\b/i.test(name)) return 'BE';
  return 'TE';
};

const inferDivisionCode = (name: string, year: Year): string => {
  const parts = name.trim().split(/\s+/);
  const last = parts[parts.length - 1] ?? 'A';
  if (last.length <= 3 && /^[A-Za-z0-9]+$/.test(last)) {
    return `${year}-${last.toUpperCase()}`;
  }
  const slug = name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toUpperCase();
  return slug.slice(0, 16) || `${year}-A`;
};

export const listBranches = (): Promise<BranchDoc[]> => Branch.find().sort({ code: 1 });
export const listAcademicYears = (): Promise<AcademicYearDoc[]> =>
  AcademicYear.find().sort({ startsAt: -1 });
export const currentAcademicYear = (): Promise<AcademicYearDoc | null> =>
  AcademicYear.findOne({ isCurrent: true });

export const listDivisions = (filter: { branch?: string; year?: string } = {}): Promise<DivisionDoc[]> => {
  const q: Record<string, unknown> = {};
  if (filter.branch) q.branch = filter.branch;
  if (filter.year) q.year = filter.year;
  return Division.find(q).populate('branch academicYear').sort({ code: 1 });
};

export const findDivision = async (id: string): Promise<DivisionDoc> => {
  const doc = await Division.findById(id).populate('branch academicYear');
  if (!doc) throw NotFound('Division not found');
  return doc;
};

export const listSubjects = (filter: { branch?: string; year?: string } = {}): Promise<SubjectDoc[]> => {
  const q: Record<string, unknown> = {};
  if (filter.branch) q.branch = filter.branch;
  if (filter.year) q.year = filter.year;
  return Subject.find(q).populate('branch').sort({ code: 1 });
};

export const findSubject = async (id: string): Promise<SubjectDoc> => {
  const doc = await Subject.findById(id).populate('branch');
  if (!doc) throw NotFound('Subject not found');
  return doc;
};

export const listStudentsInDivision = (divisionId: Types.ObjectId | string): Promise<StudentDoc[]> => {
  return Student.find({ divisionRef: divisionId }).sort({ rollNumber: 1, name: 1 });
};

export const findTeacher = async (id: string): Promise<TeacherDoc> => {
  const doc = await Teacher.findById(id)
    .populate('divisionRefs subjectRefs branchRef');
  if (!doc) throw NotFound('Teacher not found');
  return doc;
};

const resolveBranch = async (branchInput: string): Promise<BranchDoc> => {
  if (Types.ObjectId.isValid(branchInput)) {
    const byId = await Branch.findById(branchInput);
    if (byId) return byId;
  }
  const rx = new RegExp(`^${escapeRegex(branchInput)}$`, 'i');
  const byCodeOrName = await Branch.findOne({ $or: [{ code: rx }, { name: rx }] });
  if (!byCodeOrName) throw BadRequest(`Branch "${branchInput}" not found`);
  return byCodeOrName;
};

const resolveAcademicYear = async (yearInput: string): Promise<AcademicYearDoc> => {
  if (Types.ObjectId.isValid(yearInput)) {
    const byId = await AcademicYear.findById(yearInput);
    if (byId) return byId;
  }
  const rx = new RegExp(`^${escapeRegex(yearInput)}$`, 'i');
  const byCode = await AcademicYear.findOne({ code: rx });
  if (!byCode) throw BadRequest(`Academic year "${yearInput}" not found`);
  return byCode;
};

const resolveDivision = async (divInput: string): Promise<DivisionDoc> => {
  if (Types.ObjectId.isValid(divInput)) {
    const byId = await Division.findById(divInput);
    if (byId) return byId;
  }
  const rx = new RegExp(`^${escapeRegex(divInput)}$`, 'i');
  const byCodeOrName = await Division.findOne({ $or: [{ code: rx }, { name: rx }] });
  if (!byCodeOrName) throw BadRequest(`Division "${divInput}" not found`);
  return byCodeOrName;
};

export const createDivision = async (input: CreateDivisionInput): Promise<DivisionDoc> => {
  const [branchDoc, ayDoc] = await Promise.all([
    resolveBranch(input.branch),
    resolveAcademicYear(input.academicYear),
  ]);

  const year: Year = input.year ?? inferYearFromName(input.name);
  const code = (input.code ? input.code.toUpperCase() : inferDivisionCode(input.name, year));

  const nameRx = new RegExp(`^${escapeRegex(input.name)}$`, 'i');
  const existing = await Division.findOne({
    academicYear: ayDoc._id,
    $or: [{ code }, { name: nameRx }],
  });
  if (existing) {
    throw Conflict(`A class/division with code "${code}" or name "${input.name}" already exists for ${ayDoc.code}`);
  }

  const created = await Division.create({
    code,
    name: input.name,
    branch: branchDoc._id,
    year,
    academicYear: ayDoc._id,
  });
  return Division.findById(created._id).populate('branch academicYear') as Promise<DivisionDoc>;
};

export const createSubject = async (input: CreateSubjectInput): Promise<SubjectDoc> => {
  const divisionDoc = await resolveDivision(input.division);
  const code = input.code.toUpperCase();

  const existing = await Subject.findOne({ code });
  if (existing) {
    throw Conflict(`A subject with code "${code}" already exists`);
  }

  const created = await Subject.create({
    code,
    name: input.name,
    branch: divisionDoc.branch,
    year: divisionDoc.year,
    credits: input.credits,
    minAttendancePct: input.minAttendancePct,
  });
  return Subject.findById(created._id).populate('branch') as Promise<SubjectDoc>;
};
