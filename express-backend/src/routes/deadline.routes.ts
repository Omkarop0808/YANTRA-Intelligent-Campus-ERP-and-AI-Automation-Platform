import { Router } from 'express';
import { requireAuth, requireActiveAccount, requireRole } from '../middlewares/auth.middleware';
import * as ctl from '../controllers/deadline.controller';

const router = Router();

router.post(
  '/deadlines/personal',
  requireAuth,
  requireActiveAccount,
  requireRole('student'),
  ctl.createPersonalDeadline,
);
router.get(
  '/deadlines/personal',
  requireAuth,
  requireActiveAccount,
  requireRole('student'),
  ctl.listPersonalDeadlines,
);

export default router;
