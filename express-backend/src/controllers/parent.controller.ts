import { Request, Response } from 'express';
import { asyncHandler } from '../utils/async-handler';
import * as parentService from '../services/parent.service';

export const getChildren = asyncHandler(async (req: Request, res: Response) => {
  const parentId = req.auth!.sub;
  const children = await parentService.getLinkedChildren(parentId);
  res.json({ children });
});

export const getChildAttendance = asyncHandler(async (req: Request, res: Response) => {
  const parentId = req.auth!.sub;
  const childId = req.params.childId;
  const attendance = await parentService.getChildAttendance(parentId, childId);
  res.json(attendance);
});

export const getChildOverview = asyncHandler(async (req: Request, res: Response) => {
  const parentId = req.auth!.sub;
  const childId = req.params.childId;
  const overview = await parentService.getChildAcademicOverview(parentId, childId);
  res.json({ overview });
});
