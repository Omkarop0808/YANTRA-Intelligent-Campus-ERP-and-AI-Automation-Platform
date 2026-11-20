import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/async-handler';
import { listPendingTeachers, setTeacherStatus } from '../services/user.service';
import { logger } from '../utils/logger';
import { BadRequest } from '../utils/http-errors';
import { User } from '../models/User';
import { Student } from '../models/Student';
import { Teacher } from '../models/Teacher';
import { Division } from '../models/Division';
import { Subject } from '../models/Subject';
import { Lecture } from '../models/Lecture';
import { Schedule } from '../models/Schedule';
import { Quiz } from '../models/Quiz';
import { Resource } from '../models/Resource';
import { Submission } from '../models/Submission';

export const getAdminOverview = asyncHandler(async (_req: Request, res: Response) => {
  const [
    studentsCount,
    activeTeachersCount,
    pendingTeachers,
    divisions,
    subjectsCount,
    lecturesCount,
    schedulesCount,
    quizzesCount,
    resourcesCount,
    submissionsCount,
    recentUsers,
    studentCountsByDiv,
  ] = await Promise.all([
    Student.countDocuments(),
    Teacher.countDocuments({ status: 'active' }),
    listPendingTeachers(),
    Division.find().sort({ code: 1 }).lean(),
    Subject.countDocuments(),
    Lecture.countDocuments(),
    Schedule.countDocuments(),
    Quiz.countDocuments(),
    Resource.countDocuments(),
    Submission.countDocuments(),
    User.find().sort({ createdAt: -1 }).limit(8).select('name email role status createdAt').lean(),
    Student.aggregate([
      { $group: { _id: '$divisionRef', count: { $sum: 1 } } },
    ]),
  ]);

  const divCountMap = new Map<string, number>();
  for (const row of studentCountsByDiv) {
    if (row._id) divCountMap.set(String(row._id), row.count);
  }

  res.json({
    counts: {
      students: studentsCount,
      activeTeachers: activeTeachersCount,
      pendingTeachers: pendingTeachers.length,
      divisions: divisions.length,
      subjects: subjectsCount,
      lectures: lecturesCount,
      schedules: schedulesCount,
      quizzes: quizzesCount,
      resources: resourcesCount,
      submissions: submissionsCount,
    },
    pendingTeachers: pendingTeachers.map(t => t.toJSON()),
    divisions: divisions.map((d: any) => ({
      _id: String(d._id),
      code: d.code,
      name: d.name,
      year: d.year,
      studentCount: divCountMap.get(String(d._id)) ?? 0,
    })),
    recentUsers: recentUsers.map((u: any) => ({
      _id: String(u._id),
      name: u.name,
      email: u.email,
      role: u.role,
      status: u.status,
      createdAt: u.createdAt,
    })),
  });
});

export const getPendingTeachers = asyncHandler(async (_req: Request, res: Response) => {
  const list = await listPendingTeachers();
  res.json({ teachers: list.map(t => t.toJSON()) });
});

export const approveTeacher = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id;
  if (!id) throw BadRequest('Teacher id required');
  const updated = await setTeacherStatus(id, 'active');
  logger.info(`Teacher approved`, { id: updated._id.toString(), by: req.auth?.sub });
  res.json({ teacher: updated.toJSON() });
});

export const rejectTeacher = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id;
  if (!id) throw BadRequest('Teacher id required');
  const updated = await setTeacherStatus(id, 'rejected');
  logger.info(`Teacher rejected`, { id: updated._id.toString(), by: req.auth?.sub });
  res.json({ teacher: updated.toJSON() });
});
