import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import mongoose from 'mongoose';

// Point tests at an isolated unit-test database before loading app/env
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/yantra_test_unit';
process.env.JWT_SECRET = 'test-only-jwt-secret-key-for-unit-tests-123456';
process.env.RATE_LIMIT_ENABLED = 'false';

import { createApp } from '../app';
import { Branch } from '../models/Branch';
import { AcademicYear } from '../models/AcademicYear';
import { Division } from '../models/Division';
import { Subject } from '../models/Subject';
import { User } from '../models/User';
import { Student } from '../models/Student';
import { Teacher } from '../models/Teacher';
import { signAccessToken, hashPassword } from '../services/auth.service';

let server: http.Server;
let baseUrl: string;
let adminToken: string;
let studentToken: string;
let teacherToken: string;
let branchId: string;
let ayId: string;

async function req(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

describe('Admin Academic Setup API (POST /api/academic/divisions & /subjects)', () => {
  before(async () => {
    await mongoose.connect(process.env.MONGODB_URI!);
    await mongoose.connection.dropDatabase();

    const branch = await Branch.create({ code: 'CS', name: 'Computer Engineering' });
    branchId = branch._id.toString();

    const ay = await AcademicYear.create({
      code: '2025-26',
      startsAt: new Date('2025-07-01'),
      endsAt: new Date('2026-05-31'),
      isCurrent: true,
    });
    ayId = ay._id.toString();

    const pwHash = await hashPassword('TestPass123!');
    const adminInsert = await User.collection.insertOne({
      email: 'admin.test@university.edu',
      passwordHash: pwHash,
      name: 'Test Admin',
      role: 'admin',
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    adminToken = signAccessToken({ sub: adminInsert.insertedId.toString(), role: 'admin', status: 'active' });

    const student = await Student.create({
      email: 'student.test@university.edu',
      passwordHash: pwHash,
      name: 'Test Student',
      branch: 'Computer Engineering',
      year: 'TE',
      division: 'TE-A',
      status: 'active',
    });
    studentToken = signAccessToken({ sub: student._id.toString(), role: 'student', status: 'active' });

    const teacher = await Teacher.create({
      email: 'teacher.test@university.edu',
      passwordHash: pwHash,
      name: 'Test Teacher',
      branch: 'Computer Engineering',
      status: 'active',
    });
    teacherToken = signAccessToken({ sub: teacher._id.toString(), role: 'teacher', status: 'active' });

    const app = createApp();
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  });

  it('rejects unauthenticated requests with 401', async () => {
    const r1 = await req('POST', '/api/academic/divisions', {
      body: { name: 'Third Year C', branch: branchId, academicYear: ayId },
    });
    assert.equal(r1.status, 401);

    const r2 = await req('POST', '/api/academic/subjects', {
      body: { code: 'CS-301', name: 'Data Structures', division: 'TE-C' },
    });
    assert.equal(r2.status, 401);
  });

  it('rejects non-admin users (student and teacher) with 403', async () => {
    for (const token of [studentToken, teacherToken]) {
      const r1 = await req('POST', '/api/academic/divisions', {
        token,
        body: { name: 'Third Year C', branch: branchId, academicYear: ayId },
      });
      assert.equal(r1.status, 403);

      const r2 = await req('POST', '/api/academic/subjects', {
        token,
        body: { code: 'CS-301', name: 'Data Structures', division: 'TE-C' },
      });
      assert.equal(r2.status, 403);
    }
  });

  it('validates input fields and returns 400 on missing required fields', async () => {
    const r = await req('POST', '/api/academic/divisions', {
      token: adminToken,
      body: { name: 'A' },
    });
    assert.equal(r.status, 400);
  });

  it('creates a division as admin and rejects duplicates with 409', async () => {
    const r1 = await req('POST', '/api/academic/divisions', {
      token: adminToken,
      body: { name: 'Third Year C', branch: branchId, academicYear: ayId },
    });
    assert.equal(r1.status, 201);
    assert.equal(r1.body.division.name, 'Third Year C');
    assert.equal(r1.body.division.code, 'TE-C');
    assert.equal(r1.body.division.year, 'TE');

    // Duplicate check
    const r2 = await req('POST', '/api/academic/divisions', {
      token: adminToken,
      body: { name: 'Third Year C', branch: branchId, academicYear: ayId },
    });
    assert.equal(r2.status, 409);

    const count = await Division.countDocuments({ code: 'TE-C' });
    assert.equal(count, 1);
  });

  it('creates a subject linked to a division and rejects duplicate code with 409', async () => {
    const div = await Division.findOne({ code: 'TE-C' });
    assert.ok(div);

    const r1 = await req('POST', '/api/academic/subjects', {
      token: adminToken,
      body: {
        code: 'cs-301',
        name: 'Data Structures',
        division: div._id.toString(),
      },
    });
    assert.equal(r1.status, 201);
    assert.equal(r1.body.subject.code, 'CS-301');
    assert.equal(r1.body.subject.name, 'Data Structures');
    assert.equal(r1.body.subject.year, 'TE');

    // Duplicate subject code
    const r2 = await req('POST', '/api/academic/subjects', {
      token: adminToken,
      body: {
        code: 'CS-301',
        name: 'Data Structures Duplicate',
        division: div._id.toString(),
      },
    });
    assert.equal(r2.status, 409);

    const count = await Subject.countDocuments({ code: 'CS-301' });
    assert.equal(count, 1);
  });
});
