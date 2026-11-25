import { Types } from 'mongoose';
import { Schedule, type Weekday } from '../models/Schedule';
import { BadRequest } from '../utils/http-errors';

export interface ScheduleConstraintInput {
  teacher: string;
  room: string;
  division: string;
  weekday: Weekday;
  startTime: string; // "HH:mm"
  endTime: string;   // "HH:mm"
  scheduleId?: string; // exclude when updating
}

export interface ConstraintValidationResult {
  valid: boolean;
  conflicts: string[];
}

const timesOverlap = (startA: string, endA: string, startB: string, endB: string): boolean => {
  return Math.max(timeToMins(startA), timeToMins(startB)) < Math.min(timeToMins(endA), timeToMins(endB));
};

const timeToMins = (t: string): number => {
  const [h, m] = t.split(':').map(n => parseInt(n, 10));
  return (h ?? 0) * 60 + (m ?? 0);
};

export const validateScheduleConstraints = async (
  input: ScheduleConstraintInput
): Promise<ConstraintValidationResult> => {
  const { teacher, room, division, weekday, startTime, endTime, scheduleId } = input;

  if (timeToMins(startTime) >= timeToMins(endTime)) {
    throw BadRequest('startTime must be before endTime');
  }

  const query: any = { weekday };
  if (scheduleId && Types.ObjectId.isValid(scheduleId)) {
    query._id = { $ne: new Types.ObjectId(scheduleId) };
  }

  const existingSchedules = await Schedule.find(query)
    .populate('teacher', 'name email')
    .populate('division', 'name code')
    .lean();

  const conflicts: string[] = [];

  for (const sch of existingSchedules) {
    if (!timesOverlap(startTime, endTime, sch.startTime, sch.endTime)) {
      continue;
    }

    // 1. Teacher conflict check
    if (sch.teacher && sch.teacher._id.toString() === teacher.toString()) {
      const teacherName = (sch.teacher as any).name || 'Teacher';
      conflicts.push(`${teacherName} is already assigned to a lecture in ${(sch.division as any)?.code || 'another division'} from ${sch.startTime} to ${sch.endTime}`);
    }

    // 2. Room conflict check
    if (sch.room && sch.room.trim().toLowerCase() === room.trim().toLowerCase()) {
      conflicts.push(`Room ${sch.room} is already booked from ${sch.startTime} to ${sch.endTime} for ${(sch.division as any)?.code || 'another division'}`);
    }

    // 3. Division conflict check
    if (sch.division && sch.division._id.toString() === division.toString()) {
      conflicts.push(`Division ${(sch.division as any)?.code || 'TE'} already has a lecture scheduled from ${sch.startTime} to ${sch.endTime}`);
    }
  }

  return {
    valid: conflicts.length === 0,
    conflicts,
  };
};
