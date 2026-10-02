import { StudentDetail, StudentImportPreview, StudentListResponse } from '@compintel/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  call,
  openStudentsHarness,
  startStudentsServer,
  type StudentsHarness,
} from '../testing/students.js';
import type { TestServer } from '../testing/harness.js';

/**
 * `/api/v1/students…` over a real socket (WP-17): the contract on the wire, the
 * status codes the UI switches on, and the 403s the matrix promises. Accounts
 * are stub principals, so nothing here hashes a password (R89).
 */

let h: StudentsHarness;
let server: TestServer;

beforeAll(async () => {
  h = openStudentsHarness();
  server = await startStudentsServer(h);
});

afterAll(async () => {
  await server.close();
  h.close();
});

async function create(universityId: string): Promise<StudentDetail> {
  const answer = await call(server, 'POST', '/api/v1/students', {
    as: h.alice,
    body: { universityId, fullName: 'Asha Rao', program: 'BTECH' },
  });
  expect(answer.status).toBe(200);
  return StudentDetail.parse(answer.body);
}

describe('/students', () => {
  it('needs a session', async () => {
    expect((await call(server, 'GET', '/api/v1/students')).status).toBe(401);
  });

  it('creates, reads, lists with comma-separated filters', async () => {
    const student = await create('R1');
    expect(student.mentors).toHaveLength(1);
    const read = await call(server, 'GET', `/api/v1/students/${student.id}`, { as: h.bob });
    expect(StudentDetail.parse(read.body).id).toBe(student.id);
    const list = await call(server, 'GET', '/api/v1/students?programs=BTECH,MCA&mine=true', {
      as: h.alice,
    });
    expect(StudentListResponse.parse(list.body).items.map((item) => item.id)).toContain(student.id);
    const notMine = await call(server, 'GET', '/api/v1/students?mine=true', { as: h.bob });
    expect(StudentListResponse.parse(notMine.body).total).toBe(0);
  });

  it('answers the codes the UI switches on: 409 stale, 409 taken, 422 phone, 404', async () => {
    const student = await create('R2');
    await call(server, 'PATCH', `/api/v1/students/${student.id}`, {
      as: h.alice,
      body: { branch: 'X', version: 1 },
    });
    const stale = await call(server, 'PATCH', `/api/v1/students/${student.id}`, {
      as: h.bob,
      body: { branch: 'Y', version: 1 },
    });
    expect([stale.status, stale.body.code]).toEqual([409, 'STUDENT_VERSION_CONFLICT']);
    const taken = await call(server, 'POST', '/api/v1/students', {
      as: h.bob,
      body: { universityId: 'r 2', fullName: 'B', program: 'MCA' },
    });
    expect([taken.status, taken.body.code]).toEqual([409, 'STUDENT_UNIVERSITY_ID_TAKEN']);
    const phone = await call(server, 'POST', '/api/v1/students', {
      as: h.bob,
      body: { universityId: 'R3', fullName: 'B', program: 'MCA', phone: '123' },
    });
    expect([phone.status, phone.body.code]).toEqual([422, 'STUDENT_PHONE_DISABLED']);
    const missing = await call(
      server,
      'GET',
      '/api/v1/students/01a0fa18-619e-7000-85a0-4f1dc0ceee37',
      {
        as: h.bob,
      },
    );
    expect([missing.status, missing.body.code]).toEqual([404, 'STUDENT_NOT_FOUND']);
  });

  it('erase → 403 for a professor, 200 for an administrator', async () => {
    const student = await create('R4');
    const refused = await call(server, 'POST', `/api/v1/admin/students/${student.id}/erase`, {
      as: h.alice,
      body: { universityId: 'R4' },
    });
    expect(refused.status).toBe(403);
    const done = await call(server, 'POST', `/api/v1/admin/students/${student.id}/erase`, {
      as: h.admin,
      body: { universityId: 'R4' },
    });
    expect(done.status).toBe(200);
    expect(StudentDetail.parse(done.body).fullName).toBe('Erased student');
  });

  it('student settings → 403 for a professor', async () => {
    expect(
      (await call(server, 'GET', '/api/v1/admin/settings/students', { as: h.alice })).status,
    ).toBe(403);
    const read = await call(server, 'GET', '/api/v1/admin/settings/students', { as: h.admin });
    expect(read.body).toEqual({ phoneEnabled: false, allowExternal: false });
  });

  it('mentorships: start, then end through /mentorships/:id/end', async () => {
    const student = await create('R5');
    const started = await call(server, 'POST', `/api/v1/students/${student.id}/mentorships`, {
      as: h.bob,
      body: {},
    });
    const detail = StudentDetail.parse(started.body);
    const bobs = detail.mentors.find((mentor) => mentor.userId === h.bob.id);
    const ended = await call(
      server,
      'POST',
      `/api/v1/mentorships/${bobs?.mentorshipId ?? ''}/end`,
      {
        as: h.bob,
      },
    );
    expect(ended.status).toBe(200);
  });

  it('imports over the wire: preview, then commit', async () => {
    const csv = 'Roll No,Name,Programme\nW1,Wire One,BTech\nW2,Wire Two,MCA\n';
    const previewed = await call(server, 'POST', '/api/v1/students/import/preview', {
      as: h.alice,
      body: { fileName: 'wire.csv', base64: Buffer.from(csv).toString('base64') },
    });
    const preview = StudentImportPreview.parse(previewed.body);
    expect(preview.counts.create).toBe(2);
    const committed = await call(server, 'POST', '/api/v1/students/import/commit', {
      as: h.alice,
      body: { previewId: preview.previewId, mentorMe: true, privacyNoticeShown: false },
    });
    expect(committed.body).toMatchObject({ created: 2, stale: [] });
    const bogus = await call(server, 'POST', '/api/v1/students/import/commit', {
      as: h.alice,
      body: { previewId: 'x'.repeat(32), mentorMe: true, privacyNoticeShown: false },
    });
    expect([bogus.status, bogus.body.code]).toEqual([410, 'STUDENT_IMPORT_PREVIEW_EXPIRED']);
  });

  it('tags typeahead', async () => {
    const student = await create('R6');
    await call(server, 'PUT', `/api/v1/students/${student.id}/tags`, {
      as: h.alice,
      body: { version: 1, tags: [{ name: 'Rust', relation: 'SKILL', proficiency: null }] },
    });
    const answer = await call(server, 'GET', '/api/v1/tags?kind=SKILL&text=ru', { as: h.bob });
    expect(answer.body).toEqual({ tags: [expect.objectContaining({ name: 'Rust' })] });
  });
});
