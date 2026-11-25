import { Router } from 'express';
import { requireAuth, requireRole, requireActiveAccount } from '../middlewares/auth.middleware';
import {
  getAdminOverview, getPendingTeachers, approveTeacher, rejectTeacher,
  getAgentAuditLogs, createAgentAuditLog,
} from '../controllers/admin.controller';

const router = Router();

router.use(requireAuth, requireActiveAccount);

router.get('/overview', requireRole('admin'), getAdminOverview);
router.get('/teachers/pending', requireRole('admin'), getPendingTeachers);
router.post('/teachers/:id/approve', requireRole('admin'), approveTeacher);
router.post('/teachers/:id/reject', requireRole('admin'), rejectTeacher);

// Agent Audit Log API (Admin read, authenticated tool write)
router.get('/agent-audit', requireRole('admin'), getAgentAuditLogs);
router.post('/agent-audit', createAgentAuditLog);

export default router;
