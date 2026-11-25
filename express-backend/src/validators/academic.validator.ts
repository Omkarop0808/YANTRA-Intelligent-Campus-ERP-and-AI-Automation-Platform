import { z } from 'zod';

export const createDivisionSchema = z.object({
  name: z.string().trim().min(2, 'Class name must be at least 2 characters').max(80),
  code: z.string().trim().min(1).max(20).optional(),
  year: z.enum(['FE', 'SE', 'TE', 'BE']).optional(),
  branch: z.string().trim().min(1, 'Branch is required'),
  academicYear: z.string().trim().min(1, 'Academic year is required'),
});

export const createSubjectSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2, 'Subject code must be at least 2 characters')
    .max(24)
    .transform((s) => s.toUpperCase()),
  name: z.string().trim().min(2, 'Subject name must be at least 2 characters').max(120),
  division: z.string().trim().min(1, 'Division is required'),
  credits: z.coerce.number().int().min(0).max(20).default(3),
  minAttendancePct: z.coerce.number().min(0).max(100).default(75),
});

export type CreateDivisionInput = z.infer<typeof createDivisionSchema>;
export type CreateSubjectInput = z.infer<typeof createSubjectSchema>;
