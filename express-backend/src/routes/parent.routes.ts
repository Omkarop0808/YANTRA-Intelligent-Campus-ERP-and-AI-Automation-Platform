import { Router } from 'express';
import { requireAuth, requireActiveAccount, requireRole } from '../middlewares/auth.middleware';
import * as ctl from '../controllers/parent.controller';

const router = Router();

router.use(requireAuth, requireActiveAccount, requireRole('parent', 'admin'));

router.get('/children', ctl.getChildren);
router.get('/children/:childId/attendance', ctl.getChildAttendance);
router.get('/children/:childId/overview', ctl.getChildOverview);

export default router;
