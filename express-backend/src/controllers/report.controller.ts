import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/async-handler';
import { BadRequest, Unauthorized } from '../utils/http-errors';
import {
  generateComplianceData,
  exportComplianceCsv,
  exportCompliancePdf,
} from '../services/compliance-export.service';
import { runAlertEngine } from '../services/alert-engine.service';

export const getAttendanceCompliance = asyncHandler(async (req: Request, res: Response) => {
  if (!req.auth) throw Unauthorized();
  const divisionId = (req.query.division || req.query.divisionId) as string;
  if (!divisionId) throw BadRequest('division parameter is required');

  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  const format = ((req.query.format as string) || 'csv').toLowerCase();

  const data = await generateComplianceData({ divisionId, from, to });

  if (format === 'pdf') {
    return exportCompliancePdf(data.rows, data.summary, res);
  }

  // Default CSV format
  const csv = exportComplianceCsv(data.rows, data.summary);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="attendance_compliance_${data.summary.divisionCode}.csv"`);
  res.send(csv);
});

export const triggerAlertEngine = asyncHandler(async (req: Request, res: Response) => {
  if (!req.auth) throw Unauthorized();
  const results = await runAlertEngine();
  res.json({ results });
});
