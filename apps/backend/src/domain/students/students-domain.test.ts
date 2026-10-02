import { describe, expect, it } from 'vitest';

import { fieldForHeader, mapColumns, normalizeHeader } from './import-mapping.js';
import { auditDiff, parseProgram, parseTagList, studentRef, universityIdKey } from './records.js';

/** The pure rules behind WP-17 (R91–R93): no database, no clock. */

describe('universityIdKey (R93)', () => {
  it('upper-cases and removes spaces, and keeps punctuation', () => {
    expect(universityIdKey(' ec 21 001 ')).toBe('EC21001');
    expect(universityIdKey('EC21-001')).toBe('EC21-001');
  });
});

describe('parseProgram', () => {
  it.each([
    ['B.Tech', 'BTECH'],
    ['BTech', 'BTECH'],
    ['btech', 'BTECH'],
    ['B.E.', 'BTECH'],
    ['M.Tech', 'MTECH'],
    ['B.Sc', 'BSC'],
    ['MCA', 'MCA'],
    ['Ph.D.', 'PHD'],
    ['Other', 'OTHER'],
  ])('%s → %s', (raw, program) => {
    expect(parseProgram(raw)).toBe(program);
  });

  it('refuses what it does not know', () => {
    expect(parseProgram('Diploma')).toBeUndefined();
    expect(parseProgram('')).toBeUndefined();
  });
});

describe('parseTagList', () => {
  it('reads ; or , lists with optional levels', () => {
    expect(parseTagList('Python:3; Machine Learning, Rust:1')).toEqual({
      ok: true,
      tags: [
        { name: 'Python', proficiency: 3 },
        { name: 'Machine Learning', proficiency: null },
        { name: 'Rust', proficiency: 1 },
      ],
    });
  });

  it('says which levels exist when one is wrong', () => {
    const result = parseTagList('Python:5');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('3 (Advanced)');
  });
});

describe('R92 in the domain', () => {
  it('names a student by the start of his id, never by name', () => {
    expect(studentRef('01a0fa18-619e-7000-85a0-4f1dc0ceee37')).toBe('student 01a0fa18');
  });

  it('records a personal field only as changed', () => {
    expect(
      auditDiff({ fullName: 'X', phone: '1', notes: 'n', branch: 'IT', program: 'MCA' }),
    ).toEqual({
      fullName: '<changed>',
      phone: '<changed>',
      notes: '<changed>',
      branch: 'IT',
      program: 'MCA',
    });
  });
});

describe('header aliases (R93)', () => {
  it.each([
    ['Roll No.', 'universityId'],
    ['ROLL NUMBER', 'universityId'],
    ['Enrolment No', 'universityId'],
    ['Reg. No.', 'universityId'],
    ['University ID', 'universityId'],
    ['Name', 'fullName'],
    ['College E-mail', 'institutionalEmail'],
    ['Programme', 'program'],
    ['Degree', 'program'],
    ['Branch', 'branch'],
    ['Dept', 'homeDepartment'],
    ['Batch', 'graduationYear'],
    ['Passing Year', 'graduationYear'],
    ['Skills', 'skills'],
    ['Interests', 'interests'],
    ['Remarks', 'notes'],
  ])('“%s” → %s', (header, field) => {
    expect(fieldForHeader(header)).toBe(field);
  });

  it('never guesses at a column it does not know', () => {
    for (const header of ['Hostel', 'Father’s name', 'Room No', '', 'Name 2']) {
      expect(fieldForHeader(header)).toBeUndefined();
    }
    const result = mapColumns(['Roll No', 'Name', 'Programme', 'Hostel', 'CGPA'], {
      phoneEnabled: false,
    });
    expect(result.unknownColumns).toEqual(['Hostel', 'CGPA']);
    expect(result.errors).toEqual([]);
  });

  it('normalizes headers without case or punctuation', () => {
    expect(normalizeHeader('  Roll  No. ')).toBe('roll no');
  });

  it('a missing required field is a mapping error that names it', () => {
    const result = mapColumns(['Name', 'Programme'], { phoneEnabled: false });
    expect(result.errors).toEqual([expect.objectContaining({ field: 'universityId' })]);
  });
});
