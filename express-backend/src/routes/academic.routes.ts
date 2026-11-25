import { Router } from 'express';
import { requireAuth, requireActiveAccount, requireRole } from '../middlewares/auth.middleware';
import { validateBody } from '../middlewares/validate.middleware';
import { createDivisionSchema, createSubjectSchema } from '../validators/academic.validator';
import * as ctl from '../controllers/academic.controller';

const router = Router();

router.use(requireAuth, requireActiveAccount);

router.get('/branches', ctl.getBranches);
router.get('/academic-years', ctl.getAcademicYears);

router.get('/divisions', ctl.getDivisions);
router.post('/divisions', requireRole('admin'), validateBody(createDivisionSchema), ctl.createDivision);
router.get('/divisions/:id', ctl.getDivisionById);
router.get('/divisions/:id/students', ctl.getDivisionStudents);

router.get('/subjects', ctl.getSubjects);
router.post('/subjects', requireRole('admin'), validateBody(createSubjectSchema), ctl.createSubject);

export default router;
