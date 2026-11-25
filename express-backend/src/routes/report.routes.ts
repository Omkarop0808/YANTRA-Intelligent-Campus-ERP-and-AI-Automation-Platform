import { Router } from 'express';
import { requireAuth, requireRole, requireActiveAccount } from '../middlewares/auth.middleware';
import * as ctl from '../controllers/report.controller';

const router = Router();

router.use(requireAuth, requireActiveAccount);

// Compliance Report Export — Admin and Teacher only
router.get(
  '/reports/attendance-compliance',
  requireRole('admin', 'teacher'),
  ctl.getAttendanceCompliance
);

// Trigger Alert Engine manually or via cron
router.post(
  '/alerts/run',
  requireRole('admin'),
  ctl.triggerAlertEngine
);

export default router;
