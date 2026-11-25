import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/async-handler';
import { BadRequest, Unauthorized } from '../utils/http-errors';
import { PersonalDeadline } from '../models/PersonalDeadline';

export const createPersonalDeadline = asyncHandler(async (req: Request, res: Response) => {
  if (!req.auth) throw Unauthorized();
  const { title, subject, type, deadline, confidence, lowConfidenceFields } = req.body;
  if (!title || !subject || !deadline) {
    throw BadRequest('title, subject, and deadline are required');
  }

  const doc = await PersonalDeadline.create({
    student: req.auth.sub,
    title,
    subject,
    type: type || 'notice',
    deadline: new Date(deadline),
    source: 'from notice',
    confidence: confidence ?? 1.0,
    lowConfidenceFields: lowConfidenceFields || [],
  });

  res.status(201).json({ deadline: doc });
});

export const listPersonalDeadlines = asyncHandler(async (req: Request, res: Response) => {
  if (!req.auth) throw Unauthorized();
  const list = await PersonalDeadline.find({
    student: req.auth.sub,
    deadline: { $gte: new Date() },
  })
    .sort({ deadline: 1 })
    .lean();

  res.json({ deadlines: list });
});
