import { Types } from 'mongoose';
import { User, type UserDoc } from '../models/User';
import { Student, type StudentDoc } from '../models/Student';
import { Teacher, type TeacherDoc } from '../models/Teacher';
import { Division } from '../models/Division';
import { Branch } from '../models/Branch';
import { Subject } from '../models/Subject';
import { hashPassword } from './auth.service';
import { Conflict, NotFound } from '../utils/http-errors';
import { logger } from '../utils/logger';
import type {
  StudentRegisterInput, TeacherRegisterInput,
} from '../validators/auth.validator';
import type {
  StudentProfileUpdateInput, TeacherProfileUpdateInput,
} from '../validators/profile.validator';

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const resolveDivisionDoc = async (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (Types.ObjectId.isValid(trimmed)) {
    const byId = await Division.findById(trimmed);
    if (byId) return byId;
  }
  const rx = new RegExp(`^${escapeRegex(trimmed)}$`, 'i');
  return Division.findOne({ $or: [{ code: rx }, { name: rx }] });
};

const resolveBranchDoc = async (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (Types.ObjectId.isValid(trimmed)) {
    const byId = await Branch.findById(trimmed);
    if (byId) return byId;
  }
  const rx = new RegExp(`^${escapeRegex(trimmed)}$`, 'i');
  return Branch.findOne({ $or: [{ code: rx }, { name: rx }] });
};

const resolveSubjectDoc = async (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (Types.ObjectId.isValid(trimmed)) {
    const byId = await Subject.findById(trimmed);
    if (byId) return byId;
  }
  const rx = new RegExp(`^${escapeRegex(trimmed)}$`, 'i');
  return Subject.findOne({ $or: [{ code: rx }, { name: rx }] });
};

const ensureEmailAvailable = async (email: string) => {
  const existing = await User.findOne({ email });
  if (existing) throw Conflict('An account with this email already exists');
};

export const createStudent = async (input: StudentRegisterInput): Promise<StudentDoc> => {
  await ensureEmailAvailable(input.email);
  const passwordHash = await hashPassword(input.password);

  let divisionRef: Types.ObjectId | undefined;
  let branchRef: Types.ObjectId | undefined;

  const divDoc = await resolveDivisionDoc(input.division);
  if (divDoc) {
    divisionRef = divDoc._id;
    branchRef = divDoc.branch;
  } else {
    logger.warn(`createStudent: division "${input.division}" did not resolve to a Division document; keeping string value only`);
    const branchDoc = await resolveBranchDoc(input.branch);
    if (branchDoc) {
      branchRef = branchDoc._id;
    } else {
      logger.warn(`createStudent: branch "${input.branch}" did not resolve to a Branch document; keeping string value only`);
    }
  }

  const doc = await Student.create({
    email: input.email,
    passwordHash,
    name: input.name,
    branch: input.branch,
    year: input.year,
    division: input.division,
    rollNumber: input.rollNumber,
    divisionRef,
    branchRef,
    status: 'active',
  });
  return doc;
};

export const createTeacher = async (input: TeacherRegisterInput): Promise<TeacherDoc> => {
  await ensureEmailAvailable(input.email);
  const passwordHash = await hashPassword(input.password);

  let branchRef: Types.ObjectId | undefined;
  const branchDoc = await resolveBranchDoc(input.branch);
  if (branchDoc) {
    branchRef = branchDoc._id;
  } else {
    logger.warn(`createTeacher: branch "${input.branch}" did not resolve to a Branch document; keeping string value only`);
  }

  const divisionRefs: Types.ObjectId[] = [];
  const seenDivs = new Set<string>();
  for (const divName of input.assignedDivisions ?? []) {
    const divDoc = await resolveDivisionDoc(divName);
    if (divDoc) {
      const idStr = divDoc._id.toString();
      if (!seenDivs.has(idStr)) {
        seenDivs.add(idStr);
        divisionRefs.push(divDoc._id);
      }
      if (!branchRef) branchRef = divDoc.branch;
    } else {
      logger.warn(`createTeacher: assigned division "${divName}" did not resolve to a Division document; keeping string value only`);
    }
  }

  const subjectRefs: Types.ObjectId[] = [];
  const seenSubs = new Set<string>();
  for (const courseName of input.courses ?? []) {
    const subDoc = await resolveSubjectDoc(courseName);
    if (subDoc) {
      const idStr = subDoc._id.toString();
      if (!seenSubs.has(idStr)) {
        seenSubs.add(idStr);
        subjectRefs.push(subDoc._id);
      }
    } else {
      logger.warn(`createTeacher: course "${courseName}" did not resolve to a Subject document; keeping string value only`);
    }
  }

  const doc = await Teacher.create({
    email: input.email,
    passwordHash,
    name: input.name,
    branch: input.branch,
    department: input.department,
    courses: input.courses,
    assignedDivisions: input.assignedDivisions,
    branchRef,
    divisionRefs,
    subjectRefs,
    status: 'pending',
  });
  return doc;
};

export const findUserByEmailWithPassword = async (email: string): Promise<UserDoc | null> => {
  return User.findOne({ email }).select('+passwordHash');
};

export const findUserById = async (id: string): Promise<UserDoc | null> => {
  return User.findById(id);
};

export const updateStudentProfile = async (
  id: string, patch: StudentProfileUpdateInput
): Promise<StudentDoc> => {
  const doc = await Student.findByIdAndUpdate(id, patch, { new: true, runValidators: true });
  if (!doc) throw NotFound('Student profile not found');
  return doc;
};

export const updateTeacherProfile = async (
  id: string, patch: TeacherProfileUpdateInput
): Promise<TeacherDoc> => {
  const doc = await Teacher.findByIdAndUpdate(id, patch, { new: true, runValidators: true });
  if (!doc) throw NotFound('Teacher profile not found');
  return doc;
};

export const listPendingTeachers = async (): Promise<TeacherDoc[]> => {
  return Teacher.find({ status: 'pending' }).sort({ createdAt: -1 });
};

export const setTeacherStatus = async (
  id: string, status: 'active' | 'rejected'
): Promise<TeacherDoc> => {
  const doc = await Teacher.findOneAndUpdate(
    { _id: id, role: 'teacher' },
    { status },
    { new: true }
  );
  if (!doc) throw NotFound('Teacher not found');
  return doc;
};
