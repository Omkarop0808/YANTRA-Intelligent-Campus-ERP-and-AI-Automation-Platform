import { Types } from 'mongoose';
import { Student } from '../models/Student';
import { Attendance } from '../models/Attendance';
import { QuizAttempt } from '../models/QuizAttempt';
import { Resource } from '../models/Resource';
import { Submission } from '../models/Submission';
import { computeClassesNeeded } from './attendance.service';

export interface FocusStudent {
  student: {
    id: string;
    name: string;
    email: string;
    rollNumber?: string;
  };
  division: {
    id: string;
    name?: string;
    code?: string;
  };
  riskScore: number;
  riskTier: 'HIGH' | 'MEDIUM' | 'LOW';
  factors: {
    attendance: {
      total: number;
      attended: number;
      percentage: number;
      classesNeeded: number;
      isDefaulter: boolean;
    };
    quizzes: {
      attempted: number;
      failedCount: number;
      averageScore: number;
    };
    assignments: {
      missingCount: number;
    };
  };
  reasons: string[];
}

export const getFocusList = async (divisionId?: string): Promise<FocusStudent[]> => {
  const query: any = {};
  if (divisionId && Types.ObjectId.isValid(divisionId)) {
    query.division = new Types.ObjectId(divisionId);
  }

  const students = await Student.find(query).populate('division', 'name code').lean();
  if (!students.length) return [];

  // Find assignments for this division
  const resourceQuery: any = { kind: 'assignment' };
  if (divisionId && Types.ObjectId.isValid(divisionId)) {
    resourceQuery.division = new Types.ObjectId(divisionId);
  }
  const assignments = await Resource.find(resourceQuery).select('_id').lean();
  const assignmentIds = assignments.map(a => a._id);

  const focusList: FocusStudent[] = [];

  for (const stu of students) {
    const studentId = stu._id;

    // 1. Attendance Analysis
    const attRecords = await Attendance.find({ student: studentId }).lean();
    const totalAtt = attRecords.length;
    const attendedCount = attRecords.filter(a => a.status === 'present' || a.status === 'late').length;
    const attPct = totalAtt > 0 ? Math.round((attendedCount / totalAtt) * 1000) / 10 : 100;
    const isDefaulter = attPct < 75;
    const needed = computeClassesNeeded(attendedCount, totalAtt);

    let attRisk = 0;
    const reasons: string[] = [];
    if (totalAtt > 0 && isDefaulter) {
      const deficit = 75 - attPct;
      attRisk = Math.min(50, Math.round(deficit * 1.5));
      if (attPct < 60) attRisk = Math.min(50, attRisk + 15);
      reasons.push(`Attendance is ${attPct}% (below 75%, needs ${needed} classes to recover)`);
    }

    // 2. Quiz Analysis
    const attempts = await QuizAttempt.find({ student: studentId, status: { $in: ['submitted', 'graded'] } }).lean();
    let failedQuizzes = 0;
    let totalScore = 0;
    for (const att of attempts) {
      const score = att.score ?? 0;
      totalScore += score;
      if (score < 50) failedQuizzes += 1;
    }
    const avgScore = attempts.length > 0 ? Math.round(totalScore / attempts.length) : 100;
    let quizRisk = 0;
    if (failedQuizzes > 0) {
      quizRisk = Math.min(25, failedQuizzes * 10);
      reasons.push(`${failedQuizzes} quiz attempts below passing threshold (50%)`);
    }

    // 3. Assignment Analysis
    let missingAssignments = 0;
    if (assignmentIds.length > 0) {
      const submissions = await Submission.find({
        student: studentId,
        resource: { $in: assignmentIds },
      }).select('resource').lean();
      const submittedIds = new Set(submissions.map(s => s.resource.toString()));
      missingAssignments = assignmentIds.filter(id => !submittedIds.has(id.toString())).length;
    }
    let assignRisk = 0;
    if (missingAssignments > 0) {
      assignRisk = Math.min(25, missingAssignments * 10);
      reasons.push(`${missingAssignments} overdue or unsubmitted assignments`);
    }

    // Composite Risk Score
    const totalScoreRisk = Math.min(100, attRisk + quizRisk + assignRisk);
    let tier: 'HIGH' | 'MEDIUM' | 'LOW' = 'LOW';
    if (totalScoreRisk >= 50) tier = 'HIGH';
    else if (totalScoreRisk >= 25) tier = 'MEDIUM';

    if (reasons.length === 0) {
      reasons.push('Academic performance and attendance within normal benchmarks');
    }

    focusList.push({
      student: {
        id: studentId.toString(),
        name: stu.name,
        email: stu.email,
        rollNumber: (stu as any).rollNumber,
      },
      division: {
        id: stu.division ? (stu.division as any)._id?.toString() || stu.division.toString() : '',
        name: (stu.division as any)?.name,
        code: (stu.division as any)?.code,
      },
      riskScore: totalScoreRisk,
      riskTier: tier,
      factors: {
        attendance: {
          total: totalAtt,
          attended: attendedCount,
          percentage: attPct,
          classesNeeded: needed,
          isDefaulter,
        },
        quizzes: {
          attempted: attempts.length,
          failedCount: failedQuizzes,
          averageScore: avgScore,
        },
        assignments: {
          missingCount: missingAssignments,
        },
      },
      reasons,
    });
  }

  // Sort descending by riskScore
  focusList.sort((a, b) => b.riskScore - a.riskScore);
  return focusList;
};
