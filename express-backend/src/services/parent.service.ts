import { Types } from 'mongoose';
import { Parent } from '../models/Parent';
import { Student } from '../models/Student';
import { NotFound, Forbidden, BadRequest } from '../utils/http-errors';
import { studentSubjectAttendance, getStudentRecoveryPlan } from './attendance.service';
import { getStudentOverview } from './student-overview.service';

const toId = (id: string) => {
  if (!Types.ObjectId.isValid(id)) throw BadRequest('Invalid identifier');
  return new Types.ObjectId(id);
};

export const getLinkedChildren = async (parentId: string) => {
  const parent = await Parent.findById(toId(parentId)).lean();
  if (!parent) throw NotFound('Parent account not found');

  const childrenIds = (parent.children || []).map(c => toId(c.toString()));
  const students = await Student.find({ _id: { $in: childrenIds } })
    .populate('division', 'name code')
    .populate('branchRef', 'name code')
    .select('name email rollNumber division year branch')
    .lean();

  return students;
};

const verifyParentChildLink = async (parentId: string, childId: string) => {
  const pId = toId(parentId);
  const cId = toId(childId);
  const parent = await Parent.findById(pId).lean();
  if (!parent) throw NotFound('Parent account not found');

  const isLinked = (parent.children || []).some(c => c.toString() === cId.toString());
  if (!isLinked) {
    throw Forbidden('Access denied: Student is not registered under your parent account');
  }
};

export const getChildAttendance = async (parentId: string, childId: string) => {
  await verifyParentChildLink(parentId, childId);
  const [subjects, recovery] = await Promise.all([
    studentSubjectAttendance(childId),
    getStudentRecoveryPlan(childId),
  ]);

  const totalLectures = subjects.reduce((sum, s) => sum + s.total, 0);
  const totalAttended = subjects.reduce((sum, s) => sum + s.present, 0);
  const overallPercentage = totalLectures > 0 ? Math.round((totalAttended / totalLectures) * 1000) / 10 : 100;

  return {
    studentId: childId,
    overall: {
      total: totalLectures,
      attended: totalAttended,
      percentage: overallPercentage,
      isDefaulter: overallPercentage < 75,
    },
    subjects,
    recoveryPlan: recovery,
  };
};

export const getChildAcademicOverview = async (parentId: string, childId: string) => {
  await verifyParentChildLink(parentId, childId);
  return await getStudentOverview(childId);
};
