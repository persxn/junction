import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openStudentsHarness, type StudentsHarness } from '../../testing/students.js';
import { STUDENTS_ALLOW_EXTERNAL, STUDENTS_PHONE_ENABLED } from './settings.js';

/**
 * Students at the service level (WP-17): R91's scope and mentorships, the two
 * settings' gates, §6.1's versions, and the tag set's no-op rule.
 */

let h: StudentsHarness;

beforeEach(() => {
  h = openStudentsHarness();
});

afterEach(() => {
  h.close();
});

const auditActions = (): string[] =>
  (
    h.database.db.raw.prepare('SELECT action FROM audit_log ORDER BY rowid').all() as {
      action: string;
    }[]
  ).map((row) => row.action);

function asha(mentorMe = true) {
  return h.module.records.create(h.context(h.alice), {
    universityId: 'cs21 001',
    fullName: 'Asha Rao',
    institutionalEmail: 'Asha.Rao@Example.edu',
    program: 'BTECH',
    branch: 'Computer Science',
    graduationYear: 2027,
    privacyNoticeShown: true,
    mentorMe,
  });
}

describe('create and edit', () => {
  it('stores the record in the managing department, mentored by its creator (R91)', () => {
    const student = asha();
    expect(student).toMatchObject({
      universityId: 'cs21 001',
      institutionalEmail: 'asha.rao@example.edu',
      homeDepartmentName: 'Computer Science and Engineering',
      status: 'ACTIVE',
      version: 1,
    });
    expect(student.privacyNoticeAckAt).not.toBeNull();
    expect(student.mentors.map((mentor) => mentor.displayName)).toEqual(['Alice Professor']);
    expect(student.canDeactivate).toBe(true);
    expect(student.canErase).toBe(false);
    // Phone is not even part of the answer while phones are off.
    expect('phone' in student).toBe(false);
  });

  it('“I mentor these students” cleared makes no mentorship', () => {
    expect(asha(false).mentors).toEqual([]);
  });

  it('refuses a second student with the same roll number, however it is spaced (R93)', () => {
    asha();
    expect(() =>
      h.module.records.create(h.context(h.bob), {
        universityId: 'CS21001',
        fullName: 'Another',
        program: 'MCA',
        mentorMe: false,
      }),
    ).toThrow(expect.objectContaining({ code: 'STUDENT_UNIVERSITY_ID_TAKEN', status: 409 }));
  });

  it('lets every professor edit every student (R91)', () => {
    const student = asha();
    const edited = h.module.records.update(h.context(h.bob), student.id, {
      branch: 'Data Science',
      version: student.version,
    });
    expect(edited).toMatchObject({ branch: 'Data Science', version: 2 });
  });

  it('a stale version is a 409 that writes nothing', () => {
    const student = asha();
    h.module.records.update(h.context(h.bob), student.id, { branch: 'X', version: 1 });
    const before = auditActions().length;
    expect(() =>
      h.module.records.update(h.context(h.alice), student.id, { branch: 'Y', version: 1 }),
    ).toThrow(
      expect.objectContaining({
        code: 'STUDENT_VERSION_CONFLICT',
        status: 409,
        detail: 'Someone else changed this student — reload to see their changes.',
      }),
    );
    expect(auditActions()).toHaveLength(before);
    expect(h.module.records.get(h.context(h.alice), student.id).branch).toBe('X');
  });

  it('an edit that changes nothing writes no audit row', () => {
    const student = asha();
    const before = auditActions().length;
    h.module.records.update(h.context(h.alice), student.id, {
      branch: 'Computer Science',
      version: 1,
    });
    expect(auditActions()).toHaveLength(before);
  });
});

describe('the two settings, both ways (Q6, Q8)', () => {
  it('phone: refused while off, stored while on', () => {
    const request = {
      universityId: 'P1',
      fullName: 'P',
      program: 'BTECH' as const,
      phone: '98765 43210',
      mentorMe: false,
    };
    expect(() => h.module.records.create(h.context(h.alice), request)).toThrow(
      expect.objectContaining({ code: 'STUDENT_PHONE_DISABLED', status: 422 }),
    );
    h.settings.set(STUDENTS_PHONE_ENABLED, true);
    expect(h.module.records.create(h.context(h.alice), request).phone).toBe('98765 43210');
  });

  it('external: refused while off, stored while on', () => {
    const request = {
      universityId: 'X1',
      fullName: 'Guest',
      program: 'BTECH' as const,
      isExternal: true,
      externalInstitution: 'Another College',
      mentorMe: false,
    };
    expect(() => h.module.records.create(h.context(h.alice), request)).toThrow(
      expect.objectContaining({ code: 'STUDENT_EXTERNAL_DISABLED', status: 422 }),
    );
    h.settings.set(STUDENTS_ALLOW_EXTERNAL, true);
    expect(h.module.records.create(h.context(h.alice), request)).toMatchObject({
      isExternal: true,
      externalInstitution: 'Another College',
    });
  });

  it('only an administrator changes them, and the change is audited', () => {
    expect(() =>
      h.module.lifecycle.updateSettings(h.context(h.alice), {
        phoneEnabled: true,
        allowExternal: false,
      }),
    ).toThrow(expect.objectContaining({ status: 403 }));
    expect(
      h.module.lifecycle.updateSettings(h.context(h.admin), {
        phoneEnabled: true,
        allowExternal: true,
      }),
    ).toEqual({ phoneEnabled: true, allowExternal: true });
    expect(auditActions()).toContain('settings.students.changed');
  });
});

describe('skills and interests: the whole set, with the version', () => {
  it('writes the set, then a no-op writes nothing', () => {
    const student = asha();
    const tags = [
      { name: 'Python', relation: 'SKILL' as const, proficiency: 3 as const },
      { name: 'Hackathons', relation: 'INTEREST' as const, proficiency: null },
    ];
    const set = h.module.relations.setTags(h.context(h.bob), student.id, { tags, version: 1 });
    expect(set.tags.map((tag) => [tag.name, tag.relation, tag.proficiency])).toEqual([
      ['Python', 'SKILL', 3],
      ['Hackathons', 'INTEREST', null],
    ]);
    expect(set.version).toBe(2);
    const before = auditActions().length;
    const again = h.module.relations.setTags(h.context(h.bob), student.id, {
      tags: [{ ...tags[0]!, name: 'python' }, tags[1]!],
      version: 2,
    });
    expect(again.version).toBe(2);
    expect(auditActions()).toHaveLength(before);
  });

  it('suggests existing names, skills from technology words too', () => {
    const student = asha();
    h.module.relations.setTags(h.context(h.alice), student.id, {
      tags: [{ name: 'Machine Learning', relation: 'SKILL', proficiency: null }],
      version: 1,
    });
    expect(
      h.module.relations.suggestTags(h.context(h.bob), { kind: 'SKILL', text: 'mach' }).tags,
    ).toEqual([expect.objectContaining({ name: 'Machine Learning' })]);
  });
});

describe('mentorships (R91) and deactivation (§10.2)', () => {
  it('a professor starts and ends only his own; an admin anyone’s', () => {
    const student = asha(false);
    expect(() =>
      h.module.relations.startMentorship(h.context(h.alice), student.id, {
        mentorUserId: h.bob.id,
      }),
    ).toThrow(expect.objectContaining({ status: 403 }));
    const mine = h.module.relations.startMentorship(h.context(h.alice), student.id, {});
    expect(() => h.module.relations.startMentorship(h.context(h.alice), student.id, {})).toThrow(
      expect.objectContaining({ code: 'STUDENT_ALREADY_MENTORED' }),
    );
    const bobs = h.module.relations.startMentorship(h.context(h.admin), student.id, {
      mentorUserId: h.bob.id,
    });
    const bobMentorship = bobs.mentors.find((mentor) => mentor.userId === h.bob.id)!;
    expect(() =>
      h.module.relations.endMentorship(h.context(h.alice), bobMentorship.mentorshipId),
    ).toThrow(expect.objectContaining({ status: 403 }));
    const aliceMentorship = mine.mentors[0]!;
    const ended = h.module.relations.endMentorship(
      h.context(h.alice),
      aliceMentorship.mentorshipId,
    );
    // Ending keeps the row (R91), with its end date.
    expect(
      ended.mentors.find((mentor) => mentor.mentorshipId === aliceMentorship.mentorshipId)?.endedAt,
    ).not.toBeNull();
  });

  it('deactivate: mentor ✓, ended mentorship ✗, admin ✓, and reactivate the same way', () => {
    const student = asha();
    expect(() =>
      h.module.lifecycle.deactivate(h.context(h.bob), student.id, { version: student.version }),
    ).toThrow(expect.objectContaining({ status: 403 }));
    const off = h.module.lifecycle.deactivate(h.context(h.alice), student.id, { version: 1 });
    expect(off.status).toBe('INACTIVE');
    const on = h.module.lifecycle.reactivate(h.context(h.admin), student.id, {
      version: off.version,
    });
    expect(on.status).toBe('ACTIVE');
    h.module.relations.endMentorship(h.context(h.alice), on.mentors[0]!.mentorshipId);
    expect(() =>
      h.module.lifecycle.deactivate(h.context(h.alice), student.id, { version: on.version }),
    ).toThrow(expect.objectContaining({ status: 403 }));
  });
});

describe('the list', () => {
  it('pages by name, filters, and says which students are mine', () => {
    for (let i = 0; i < 7; i += 1) {
      h.module.records.create(h.context(i % 2 === 0 ? h.alice : h.bob), {
        universityId: `L${String(i)}`,
        fullName: `Student ${String.fromCharCode(71 - i)}`,
        program: i < 3 ? 'BTECH' : 'MCA',
        graduationYear: 2026 + (i % 2),
        mentorMe: true,
      });
    }
    const context = h.context(h.alice);
    const first = h.module.records.list(context, { limit: 4 });
    expect(first.total).toBe(7);
    expect(first.items.map((item) => item.fullName)).toEqual([
      'Student A',
      'Student B',
      'Student C',
      'Student D',
    ]);
    const second = h.module.records.list(context, {
      limit: 4,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.items.map((item) => item.fullName)).toEqual([
      'Student E',
      'Student F',
      'Student G',
    ]);
    expect(second.nextCursor).toBeNull();
    expect(h.module.records.list(context, { limit: 50, mine: true }).total).toBe(4);
    expect(h.module.records.list(context, { limit: 50, programs: ['MCA'] }).total).toBe(4);
    expect(h.module.records.list(context, { limit: 50, text: 'student c' }).items).toHaveLength(1);
    expect(first.facets.graduationYears).toEqual([2026, 2027]);
  });
});
