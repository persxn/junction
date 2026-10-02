import { readFileSync } from 'node:fs';
import path from 'node:path';

import Papa from 'papaparse';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openStudentsHarness, type StudentsHarness } from '../../../testing/students.js';
import {
  IMPORT_500_ERROR_RULES,
  import500Csv,
  seedDemoStudents,
} from '../../../testing/students-demo.js';
import { writeWorkbook } from '../../../testing/xlsx-writer.js';

/**
 * The §19 acceptance criterion for WP-17: "Import 500 rows with per-row errors".
 *
 * `import-500.csv` holds 400 new students, 50 changes to the seeded 60, 10 rows
 * equal to them and 40 rows that each break one rule. Its XLSX twin is written
 * at test time by `testing/xlsx-writer.ts` (exceljs failed the dependency audit).
 */

const FIXTURE = path.resolve(
  import.meta.dirname,
  '../../../../test/fixtures/students/import-500.csv',
);

let h: StudentsHarness;

beforeEach(() => {
  h = openStudentsHarness();
  seedDemoStudents(h.module, h.alice);
});

afterEach(() => {
  h.close();
});

function csvBase64(): string {
  return readFileSync(FIXTURE).toString('base64');
}

function xlsxBase64(): string {
  const rows = Papa.parse<string[]>(readFileSync(FIXTURE, 'utf8'), { skipEmptyLines: true }).data;
  return writeWorkbook(rows).toString('base64');
}

const auditCount = (): number =>
  (h.database.db.raw.prepare('SELECT count(*) AS n FROM audit_log').get() as { n: number }).n;

describe('import-500 (the §19 criterion)', () => {
  it('the committed file is exactly what the generator writes', () => {
    expect(readFileSync(FIXTURE, 'utf8')).toBe(import500Csv());
  });

  it.each([
    ['CSV', 'import-500.csv', csvBase64],
    ['XLSX', 'import-500.xlsx', xlsxBase64],
  ])(
    '%s previews exactly 400 / 50 / 10 / 40, every error on its row and field',
    (format, fileName, read) => {
      const preview = h.module.imports.preview(h.context(h.bob), {
        fileName,
        base64: read(),
      });
      expect(preview.format).toBe(format);
      expect(preview.mappingErrors).toEqual([]);
      expect(preview.unknownColumns).toEqual(['Hostel']);
      expect(preview.counts).toEqual({ create: 400, update: 50, skip: 10, error: 40, total: 500 });

      const failing = preview.rows.filter((row) => row.errors.length > 0);
      expect(failing).toHaveLength(40);
      // Error row k sits at data position 12(k+1), i.e. spreadsheet row 12(k+1) + 2.
      failing.forEach((row, k) => {
        expect(row.rowNumber).toBe(12 * (k + 1) + 2);
        expect(row.errors).toHaveLength(1);
        expect(row.errors[0]?.field).toBe(IMPORT_500_ERROR_RULES[k % 10]?.field);
      });
      const update = preview.rows.find((row) => row.action === 'UPDATE');
      expect(update?.changes).toHaveLength(1);
      expect(update?.changes[0]).toMatchObject({ field: 'branch', to: 'Information Technology' });
    },
  );

  it('commit creates 400, updates 50, skips 10, audits 1 + 450 rows and nothing for the 40', () => {
    const preview = h.module.imports.preview(h.context(h.bob), {
      fileName: 'import-500.csv',
      base64: csvBase64(),
    });
    const before = auditCount();
    const result = h.module.imports.commit(h.context(h.bob), {
      previewId: preview.previewId,
      mentorMe: true,
      privacyNoticeShown: true,
    });
    expect(result).toEqual({ created: 400, updated: 50, skipped: 10, failed: 40, stale: [] });
    expect(auditCount() - before).toBe(1 + 450);
    const summary = h.database.db.raw
      .prepare("SELECT count(*) AS n FROM audit_log WHERE action = 'student.import.committed'")
      .get() as { n: number };
    expect(summary.n).toBe(1);
    const count = (sql: string): number =>
      (h.database.db.raw.prepare(sql).get() as { n: number }).n;
    expect(count('SELECT count(*) AS n FROM students')).toBe(460);
    expect(count("SELECT count(*) AS n FROM students WHERE university_id LIKE 'ERR%'")).toBe(0);
    // R91: the importer mentors what he created, and only that.
    expect(
      count(`SELECT count(*) AS n FROM mentorships WHERE mentor_user_id = '${h.bob.id}'`),
    ).toBe(400);
    // R93: an import never changes status.
    expect(count("SELECT count(*) AS n FROM students WHERE status <> 'ACTIVE'")).toBe(0);
    // The same preview cannot be committed twice.
    expect(() =>
      h.module.imports.commit(h.context(h.bob), {
        previewId: preview.previewId,
        mentorMe: true,
        privacyNoticeShown: true,
      }),
    ).toThrow(expect.objectContaining({ code: 'STUDENT_IMPORT_PREVIEW_EXPIRED', status: 410 }));
  });
});
