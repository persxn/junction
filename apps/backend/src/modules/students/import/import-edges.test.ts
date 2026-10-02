import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openStudentsHarness, type StudentsHarness } from '../../../testing/students.js';
import { writeWorkbook } from '../../../testing/xlsx-writer.js';

/**
 * Ruling R93's edges: the preview's lifetime and owner, a row gone stale, and
 * the files a department actually produces — a BOM, semicolons, a newline
 * inside a quoted cell — plus the ones it must refuse.
 */

let h: StudentsHarness;

beforeEach(() => {
  h = openStudentsHarness();
});

afterEach(() => {
  h.close();
});

const b64 = (text: string | Buffer): string => Buffer.from(text).toString('base64');
const HEADER = 'Roll No,Name,Programme\n';

function preview(fileName: string, content: string | Buffer) {
  return h.module.imports.preview(h.context(h.alice), { fileName, base64: b64(content) });
}

describe('the preview lives 30 minutes, for its owner only', () => {
  it('expires → 410', () => {
    const made = preview('a.csv', `${HEADER}CS1,Asha Rao,B.Tech\n`);
    h.clock.advance(31 * 60_000);
    expect(() =>
      h.module.imports.commit(h.context(h.alice), {
        previewId: made.previewId,
        mentorMe: false,
        privacyNoticeShown: false,
      }),
    ).toThrow(expect.objectContaining({ status: 410, code: 'STUDENT_IMPORT_PREVIEW_EXPIRED' }));
  });

  it('another user’s preview id → 404, as if it did not exist', () => {
    const made = preview('a.csv', `${HEADER}CS1,Asha Rao,B.Tech\n`);
    expect(() =>
      h.module.imports.commit(h.context(h.bob), {
        previewId: made.previewId,
        mentorMe: false,
        privacyNoticeShown: false,
      }),
    ).toThrow(expect.objectContaining({ status: 404 }));
  });

  it('a student created between preview and commit makes that row stale and unapplied', () => {
    const made = preview('a.csv', `${HEADER}CS1,Asha Rao,B.Tech\nCS2,Ravi Iyer,B.Tech\n`);
    h.module.records.create(h.context(h.bob), {
      universityId: 'cs 1',
      fullName: 'Someone Else',
      program: 'MCA',
      mentorMe: false,
    });
    const result = h.module.imports.commit(h.context(h.alice), {
      previewId: made.previewId,
      mentorMe: false,
      privacyNoticeShown: false,
    });
    expect(result.created).toBe(1);
    expect(result.stale).toEqual([
      { rowNumber: 2, reason: 'A student with this roll number was added after the preview.' },
    ]);
    const kept = h.module.repository.findByKey(h.organizationId, 'CS1');
    expect(kept?.fullName).toBe('Someone Else');
  });
});

describe('the files departments actually have', () => {
  it('reads a BOM, semicolons and a newline inside a quoted cell', () => {
    const csv = '﻿Roll No;Name;Programme;Notes\nCS1;Asha Rao;BTech;"line one\nline two"\n';
    const made = preview('semi.csv', csv);
    expect(made.mappingErrors).toEqual([]);
    expect(made.columns.map((column) => column.field)).toEqual([
      'universityId',
      'fullName',
      'program',
      'notes',
    ]);
    expect(made.rows[0]?.values).toMatchObject({
      universityId: 'CS1',
      notes: 'line one\nline two',
    });
    expect(made.counts.create).toBe(1);
  });

  it('5 001 rows → STUDENT_IMPORT_TOO_LARGE', () => {
    const rows = Array.from({ length: 5_001 }, (_, i) => `R${String(i)},N,B.Tech`).join('\n');
    expect(() => preview('big.csv', `${HEADER}${rows}\n`)).toThrow(
      expect.objectContaining({ code: 'STUDENT_IMPORT_TOO_LARGE', status: 413 }),
    );
  });

  it('a file over 700 KB → STUDENT_IMPORT_TOO_LARGE before it is read', () => {
    expect(() => preview('huge.csv', Buffer.alloc(700 * 1024 + 1, 0x41))).toThrow(
      expect.objectContaining({ code: 'STUDENT_IMPORT_TOO_LARGE' }),
    );
  });

  it('a renamed non-XLSX → STUDENT_IMPORT_FILE_INVALID', () => {
    expect(() => preview('roster.xlsx', `${HEADER}CS1,Asha,B.Tech\n`)).toThrow(
      expect.objectContaining({ code: 'STUDENT_IMPORT_FILE_INVALID', status: 422 }),
    );
  });

  it.each(['roster.xls', 'roster.exe', 'roster'])('refuses %s', (name) => {
    expect(() => preview(name, `${HEADER}CS1,Asha,B.Tech\n`)).toThrow(
      expect.objectContaining({ code: 'STUDENT_IMPORT_FILE_INVALID' }),
    );
  });

  it('reads an XLSX with a gap row and keeps spreadsheet row numbers true', () => {
    const book = writeWorkbook([
      ['Enrolment', 'Student Name', 'Degree', 'Batch'],
      ['CS1', 'Asha Rao', 'B.Tech', '2027'],
      [],
      ['CS2', 'Ravi Iyer', 'MCA', '2026'],
    ]);
    const made = preview('book.xlsx', book);
    expect(made.rows.map((row) => row.rowNumber)).toEqual([2, 4]);
    expect(made.counts.create).toBe(2);
  });
});

describe('the mapping', () => {
  it('two columns on one field is a mapping error, and nothing is planned', () => {
    const made = preview('two.csv', 'Roll No,Enrolment,Name,Programme\nA,B,Asha,BTech\n');
    expect(made.mappingErrors).toEqual([expect.objectContaining({ field: 'universityId' })]);
    expect(made.rows).toEqual([]);
    expect(() =>
      h.module.imports.commit(h.context(h.alice), {
        previewId: made.previewId,
        mentorMe: false,
        privacyNoticeShown: false,
      }),
    ).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }));
  });

  it('an override fixes it: the professor marks one column “Not imported”', () => {
    const made = h.module.imports.preview(h.context(h.alice), {
      fileName: 'two.csv',
      base64: b64('Roll No,Enrolment,Name,Programme\nA,B,Asha,BTech\n'),
      mapping: [{ index: 1, field: null }],
    });
    expect(made.mappingErrors).toEqual([]);
    expect(made.rows[0]?.values.universityId).toBe('A');
  });

  it('a phone column is not imported while phones are off', () => {
    const made = preview('p.csv', 'Roll No,Name,Programme,Mobile\nA,Asha,BTech,98765\n');
    expect(made.unknownColumns).toEqual(['Mobile']);
    expect(made.rows[0]?.values.phone).toBeUndefined();
  });
});
