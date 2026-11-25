import { Types } from 'mongoose';
import PDFDocument from 'pdfkit';
import type { Response } from 'express';
import { Attendance } from '../models/Attendance';
import { Division } from '../models/Division';
import { Student } from '../models/Student';
import { Subject } from '../models/Subject';
import { NotFound } from '../utils/http-errors';

export interface ComplianceExportQuery {
  divisionId: string;
  from?: string;
  to?: string;
  format?: 'csv' | 'pdf';
}

export interface ComplianceRow {
  studentName: string;
  rollNumber: string;
  subjectCode: string;
  subjectName: string;
  attended: number;
  total: number;
  percentage: number;
  below75: boolean;
}

export const generateComplianceData = async (query: ComplianceExportQuery) => {
  const division = await Division.findById(query.divisionId);
  if (!division) throw NotFound('Division not found');

  const match: Record<string, unknown> = { division: division._id };
  if (query.from || query.to) {
    match.markedAt = {};
    if (query.from) (match.markedAt as any).$gte = new Date(query.from);
    if (query.to) (match.markedAt as any).$lte = new Date(query.to);
  }

  const [students, subjects, stats] = await Promise.all([
    Student.find({ divisionRef: division._id }).sort({ rollNumber: 1, name: 1 }).lean(),
    Subject.find({ divisionRef: division._id }).lean(),
    Attendance.aggregate([
      { $match: match },
      {
        $group: {
          _id: { student: '$student', subject: '$subject' },
          total: { $sum: 1 },
          present: { $sum: { $cond: [{ $in: ['$status', ['present', 'late']] }, 1, 0] } },
        },
      },
    ]),
  ]);

  const statMap = new Map<string, { total: number; present: number }>();
  for (const s of stats) {
    const key = `${s._id.student.toString()}:${s._id.subject.toString()}`;
    statMap.set(key, { total: s.total, present: s.present });
  }

  const rows: ComplianceRow[] = [];
  const defaulterSet = new Set<string>();
  let grandTotal = 0;
  let grandPresent = 0;

  for (const student of students) {
    const sUserId = student._id.toString();
    for (const sub of subjects) {
      const key = `${sUserId}:${sub._id.toString()}`;
      const counts = statMap.get(key) || { total: 0, present: 0 };
      const pct = counts.total > 0 ? (counts.present / counts.total) * 100 : 100.0;
      const below75 = counts.total > 0 && pct < 75.0;

      if (below75) defaulterSet.add(sUserId);
      grandTotal += counts.total;
      grandPresent += counts.present;

      rows.push({
        studentName: student.name,
        rollNumber: student.rollNumber || '—',
        subjectCode: sub.code,
        subjectName: sub.name,
        attended: counts.present,
        total: counts.total,
        percentage: Math.round(pct * 10) / 10,
        below75,
      });
    }
  }

  const summary = {
    divisionCode: division.code,
    divisionName: division.name,
    totalStudents: students.length,
    defaultersCount: defaulterSet.size,
    overallAttendancePct: grandTotal > 0 ? Math.round((grandPresent / grandTotal) * 1000) / 10 : 100.0,
    generatedAt: new Date().toISOString(),
  };

  return { rows, summary };
};

export const exportComplianceCsv = (rows: ComplianceRow[], summary: any): string => {
  const headers = ['Roll Number', 'Student Name', 'Subject Code', 'Subject Name', 'Attended', 'Total Classes', 'Attendance %', 'Below 75% Defaulter'];
  const lines = [
    `# University Attendance Compliance Report - Division ${summary.divisionCode} (${summary.divisionName})`,
    `# Generated At: ${summary.generatedAt}`,
    headers.join(','),
  ];

  for (const r of rows) {
    lines.push([
      `"${r.rollNumber}"`,
      `"${r.studentName}"`,
      `"${r.subjectCode}"`,
      `"${r.subjectName}"`,
      r.attended,
      r.total,
      `${r.percentage}%`,
      r.below75 ? 'YES' : 'NO',
    ].join(','));
  }

  lines.push('');
  lines.push(`# --- Compliance Summary ---`);
  lines.push(`# Total Students Enrolled: ${summary.totalStudents}`);
  lines.push(`# Total Attendance Defaulters (<75%): ${summary.defaultersCount}`);
  lines.push(`# Division Overall Attendance: ${summary.overallAttendancePct}%`);

  return lines.join('\n');
};

export const exportCompliancePdf = (rows: ComplianceRow[], summary: any, res: Response): void => {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="attendance_compliance_${summary.divisionCode}.pdf"`);
  doc.pipe(res);

  doc.fontSize(18).text(`Attendance Compliance Audit: Division ${summary.divisionCode}`, { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(10).fillColor('#64748B').text(`Generated on ${new Date().toLocaleDateString()} | Compliance Threshold: 75%`);
  doc.moveDown(1);

  // Summary box
  doc.rect(40, doc.y, 515, 50).fillAndStroke('#F1F5F9', '#CBD5E1');
  const boxY = doc.y + 12;
  doc.fillColor('#0F172A').fontSize(11).text(
    `Total Students: ${summary.totalStudents}    |    Defaulters (<75%): ${summary.defaultersCount}    |    Division Avg: ${summary.overallAttendancePct}%`,
    55,
    boxY
  );
  doc.y = boxY + 45;
  doc.moveDown(1);

  // Table header
  doc.fillColor('#0F172A').fontSize(9).text('Roll', 40, doc.y, { width: 60 });
  doc.text('Name', 105, doc.y, { width: 140 });
  doc.text('Subject', 250, doc.y, { width: 120 });
  doc.text('Attended', 375, doc.y, { width: 50, align: 'right' });
  doc.text('Pct', 435, doc.y, { width: 40, align: 'right' });
  doc.text('Status', 485, doc.y, { width: 70, align: 'right' });
  doc.moveDown(0.5);
  doc.strokeColor('#CBD5E1').lineWidth(1).moveTo(40, doc.y).lineTo(555, doc.y).stroke();
  doc.moveDown(0.5);

  let count = 0;
  for (const r of rows) {
    if (doc.y > 750) {
      doc.addPage();
    }
    const y = doc.y;
    doc.fontSize(8).fillColor('#334155');
    doc.text(r.rollNumber, 40, y, { width: 60 });
    doc.text(r.studentName, 105, y, { width: 140 });
    doc.text(r.subjectCode, 250, y, { width: 120 });
    doc.text(`${r.attended}/${r.total}`, 375, y, { width: 50, align: 'right' });
    doc.text(`${r.percentage}%`, 435, y, { width: 40, align: 'right' });

    if (r.below75) {
      doc.fillColor('#DC2626').text('DEFAULTER', 485, y, { width: 70, align: 'right' });
    } else {
      doc.fillColor('#16A34A').text('ELIGIBLE', 485, y, { width: 70, align: 'right' });
    }
    doc.moveDown(0.4);
    count++;
    if (count >= 120) break; // page safety limit
  }

  doc.end();
};
