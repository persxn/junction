import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openStudentsHarness, type StudentsHarness } from '../../testing/students.js';
import { STUDENTS_PHONE_ENABLED } from './settings.js';

/**
 * Ruling R92: erasure anonymizes, and the audit chain never held the PII.
 *
 * A scripted session — create, edit, tag, import, erase — and then every audit
 * row is searched for any name, e-mail, phone or note that was typed. R35 makes
 * the chain immutable, so the only way to keep a name out of it is never to
 * write one in; this test is what proves that.
 */

let h: StudentsHarness;

beforeEach(() => {
  h = openStudentsHarness();
  h.settings.set(STUDENTS_PHONE_ENABLED, true);
});

afterEach(() => {
  h.close();
});

const PERSONAL = [
  'Meenakshi Sundaram',
  'Meenu',
  'meenakshi.s@example.edu',
  '98400 12345',
  'Prefers evening meetings',
  'Kartik Venkataraman',
  'kartik.v@example.edu',
  'Renamed Person',
];

describe('a scripted session leaves no personal data in the audit chain', () => {
  it('create, edit, tag, import, erase — then nothing personal anywhere in audit_log', () => {
    const context = h.context(h.alice);
    const meenakshi = h.module.records.create(context, {
      universityId: 'MS001',
      fullName: 'Meenakshi Sundaram',
      preferredName: 'Meenu',
      institutionalEmail: 'meenakshi.s@example.edu',
      phone: '98400 12345',
      notes: 'Prefers evening meetings',
      program: 'MTECH',
      mentorMe: true,
    });
    const edited = h.module.records.update(context, meenakshi.id, {
      fullName: 'Renamed Person',
      notes: 'Prefers evening meetings, still',
      version: meenakshi.version,
    });
    const tagged = h.module.relations.setTags(context, meenakshi.id, {
      tags: [{ name: 'Rust', relation: 'SKILL', proficiency: 2 }],
      version: edited.version,
    });
    h.module.relations.addAchievement(context, meenakshi.id, {
      title: 'Smart India Hackathon finalist',
      year: 2025,
    });
    const preview = h.module.imports.preview(context, {
      fileName: 'one.csv',
      base64: Buffer.from(
        'Roll No,Name,College Email,Programme\nKV002,Kartik Venkataraman,kartik.v@example.edu,BTech\n',
      ).toString('base64'),
    });
    h.module.imports.commit(context, {
      previewId: preview.previewId,
      mentorMe: true,
      privacyNoticeShown: true,
    });

    // The diff says *that* a personal field changed, never what to.
    const updated = h.audit.all().find((row) => row.action === 'student.updated');
    expect(JSON.parse(updated?.diffJson ?? '{}')).toEqual({
      fullName: '<changed>',
      notes: '<changed>',
    });

    const erased = h.module.lifecycle.erase(h.context(h.admin), meenakshi.id, {
      universityId: 'ms 001',
    });
    expect(erased).toMatchObject({
      fullName: 'Erased student',
      status: 'INACTIVE',
      tags: [],
      mentors: [],
      achievements: [],
    });
    expect(tagged.tags).toHaveLength(1);

    const rows = h.audit.all();
    expect(rows.map((row) => row.action)).toEqual([
      'student.created',
      'student.updated',
      'student.tags.changed',
      'student.achievement.added',
      'student.created',
      'student.import.committed',
      'student.erased',
    ]);
    for (const row of rows) {
      const text = `${row.summary} ${row.diffJson}`;
      for (const value of PERSONAL) expect(text, row.action).not.toContain(value);
    }
    expect(h.audit.verifyChain().ok).toBe(true);
  });

  it('the erased row holds no personal column, and its relations are gone', () => {
    const student = h.module.records.create(h.context(h.alice), {
      universityId: 'MS001',
      fullName: 'Meenakshi Sundaram',
      preferredName: 'Meenu',
      institutionalEmail: 'meenakshi.s@example.edu',
      phone: '98400 12345',
      notes: 'Prefers evening meetings',
      branch: 'VLSI',
      graduationYear: 2027,
      program: 'MTECH',
      mentorMe: true,
    });
    h.module.relations.setTags(h.context(h.alice), student.id, {
      tags: [{ name: 'Rust', relation: 'SKILL', proficiency: 2 }],
      version: student.version,
    });
    h.module.relations.addAchievement(h.context(h.alice), student.id, { title: 'A prize' });
    h.module.lifecycle.erase(h.context(h.admin), student.id, { universityId: 'MS001' });

    const raw = h.database.db.raw;
    const row = raw.prepare('SELECT * FROM students WHERE id = ?').get(student.id) as Record<
      string,
      unknown
    >;
    expect(row).toMatchObject({
      full_name: 'Erased student',
      university_id: `ERASED-${student.id}`,
      preferred_name: null,
      institutional_email: null,
      phone: null,
      notes: null,
      branch: null,
      graduation_year: null,
      privacy_notice_ack_at: null,
      status: 'INACTIVE',
    });
    expect(row.erased_at).not.toBeNull();
    const count = (table: string): number =>
      (
        raw.prepare(`SELECT count(*) AS n FROM ${table} WHERE student_id = ?`).get(student.id) as {
          n: number;
        }
      ).n;
    expect([count('student_tags'), count('student_achievements'), count('mentorships')]).toEqual([
      0, 0, 0,
    ]);
    // The roll number is free again, and the erased record cannot be edited.
    expect(h.module.repository.findByKey(h.organizationId, 'MS001')).toBeUndefined();
    expect(() =>
      h.module.records.update(h.context(h.admin), student.id, { notes: 'x', version: 99 }),
    ).toThrow(expect.objectContaining({ code: 'STUDENT_ERASED' }));
  });

  it('erase is an administrator’s, and needs the right roll number typed', () => {
    const student = h.module.records.create(h.context(h.alice), {
      universityId: 'MS001',
      fullName: 'M',
      program: 'MTECH',
      mentorMe: true,
    });
    expect(() =>
      h.module.lifecycle.erase(h.context(h.alice), student.id, { universityId: 'MS001' }),
    ).toThrow(expect.objectContaining({ status: 403 }));
    expect(() =>
      h.module.lifecycle.erase(h.context(h.admin), student.id, { universityId: 'MS002' }),
    ).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }));
    expect(h.module.records.get(h.context(h.admin), student.id).erasedAt).toBeNull();
  });
});
