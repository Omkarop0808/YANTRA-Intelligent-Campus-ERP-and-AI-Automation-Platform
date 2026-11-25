import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/yantra_test_relational';
process.env.JWT_SECRET = 'test-only-jwt-secret-key-for-unit-tests-123456';

import { Branch } from '../models/Branch';
import { AcademicYear } from '../models/AcademicYear';
import { Division } from '../models/Division';
import { Subject } from '../models/Subject';
import { createStudent, createTeacher } from '../services/user.service';
import { listStudentsInDivision } from '../services/academic.service';

describe('User relational link resolution (createStudent & createTeacher)', () => {
  let branchId: mongoose.Types.ObjectId;
  let divisionId: mongoose.Types.ObjectId;
  let sub1Id: mongoose.Types.ObjectId;
  let sub2Id: mongoose.Types.ObjectId;

  before(async () => {
    await mongoose.connect(process.env.MONGODB_URI!);
    await mongoose.connection.dropDatabase();

    const branch = await Branch.create({ code: 'CS', name: 'Computer Engineering' });
    branchId = branch._id;

    const ay = await AcademicYear.create({
      code: '2025-26',
      startsAt: new Date('2025-07-01'),
      endsAt: new Date('2026-05-31'),
      isCurrent: true,
    });

    const div = await Division.create({
      code: 'TE-C',
      name: 'Third Year C',
      branch: branch._id,
      year: 'TE',
      academicYear: ay._id,
    });
    divisionId = div._id;

    const s1 = await Subject.create({
      code: 'CS-301',
      name: 'Data Structures',
      branch: branch._id,
      year: 'TE',
    });
    const s2 = await Subject.create({
      code: 'CS-302',
      name: 'Operating Systems',
      branch: branch._id,
      year: 'TE',
    });
    sub1Id = s1._id;
    sub2Id = s2._id;
  });

  after(async () => {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  });

  it('createStudent resolves divisionRef and branchRef from division name ("Third Year C")', async () => {
    const student = await createStudent({
      email: 'student.rel1@university.edu',
      password: 'Password123',
      name: 'Riya Deshmukh',
      branch: 'Computer Engineering',
      year: 'TE',
      division: 'Third Year C',
      rollNumber: 'TE-C-01',
    });

    assert.equal(student.divisionRef?.toString(), divisionId.toString());
    assert.equal(student.branchRef?.toString(), branchId.toString());

    const roster = await listStudentsInDivision(divisionId);
    assert.ok(roster.some((s) => s._id.toString() === student._id.toString()));
  });

  it('createStudent keeps string behaviour without throwing when division does not resolve', async () => {
    const student = await createStudent({
      email: 'student.rel2@university.edu',
      password: 'Password123',
      name: 'Unknown Class Student',
      branch: 'Unknown Branch',
      year: 'FE',
      division: 'Nonexistent Class Z',
    });

    assert.equal(student.division, 'Nonexistent Class Z');
    assert.equal(student.divisionRef, undefined);
    assert.equal(student.branchRef, undefined);
  });

  it('createTeacher resolves divisionRefs, subjectRefs, and branchRef from names and codes', async () => {
    const teacher = await createTeacher({
      email: 'meera.iyer@university.edu',
      password: 'Password123',
      name: 'Prof. Meera Iyer',
      branch: 'Computer Engineering',
      department: 'Computer Engineering',
      assignedDivisions: ['Third Year C'],
      courses: ['Data Structures', 'CS-302'],
    });

    assert.equal(teacher.status, 'pending');
    assert.equal(teacher.branchRef?.toString(), branchId.toString());
    assert.deepEqual(
      teacher.divisionRefs.map((id) => id.toString()),
      [divisionId.toString()],
    );
    assert.deepEqual(
      teacher.subjectRefs.map((id) => id.toString()).sort(),
      [sub1Id.toString(), sub2Id.toString()].sort(),
    );
  });

  it('createTeacher keeps string values when divisions or courses do not resolve', async () => {
    const teacher = await createTeacher({
      email: 'unknown.teacher@university.edu',
      password: 'Password123',
      name: 'Prof. Unlinked',
      branch: 'Mystery Dept',
      assignedDivisions: ['Ghost Division'],
      courses: ['Quantum Basket Weaving'],
    });

    assert.deepEqual(teacher.assignedDivisions, ['Ghost Division']);
    assert.deepEqual(teacher.courses, ['Quantum Basket Weaving']);
    assert.equal(teacher.divisionRefs.length, 0);
    assert.equal(teacher.subjectRefs.length, 0);
  });
});
