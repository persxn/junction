import { describe, expect, it } from 'vitest';

import { writeWorkbook, zip } from '../../testing/xlsx-writer.js';
import { columnIndex, decodeXml, readFirstSheet } from './sheet.js';
import { MAX_ENTRY_BYTES, ZipFormatError } from './zip.js';

/**
 * The in-house XLSX reader (WP-17, owner decision of 2 Oct 2026, after exceljs
 * failed the dependency audit). It is a reader of hostile input, so the
 * failures are tested as carefully as the successes.
 */

const LIMITS = { maxRows: 5_001, maxColumns: 50 };

describe('readFirstSheet', () => {
  it('reads shared strings, numbers and the sheet name, deflated or stored', () => {
    for (const deflate of [true, false]) {
      const book = writeWorkbook(
        [
          ['Roll No', 'Name', 'Batch'],
          ['EC21001', 'Asha & Co <test>', '2027'],
        ],
        { deflate, sheetName: 'CSE 2027' },
      );
      const sheet = readFirstSheet(book, LIMITS);
      expect(sheet.sheetName).toBe('CSE 2027');
      expect(sheet.rows).toEqual([
        ['Roll No', 'Name', 'Batch'],
        ['EC21001', 'Asha & Co <test>', '2027'],
      ]);
    }
  });

  it('takes a formula’s cached value and never evaluates it', () => {
    const book = writeWorkbook(
      [
        ['A', 'B'],
        ['1', '3'],
      ],
      { formulas: new Map([['B2', '1+2']]) },
    );
    expect(readFirstSheet(book, LIMITS).rows[1]).toEqual(['1', '3']);
  });

  it('keeps blank cells and blank rows in their places', () => {
    const book = writeWorkbook([['A', '', 'C'], [], ['x', 'y', '']]);
    const rows = readFirstSheet(book, LIMITS).rows;
    expect(rows[0]).toEqual(['A', '', 'C']);
    expect(rows[1]).toEqual([]);
    expect(rows[2]).toEqual(['x', 'y']);
  });

  it('stops at the row limit and says so', () => {
    const rows = Array.from({ length: 12 }, (_, i) => [`r${String(i)}`]);
    const sheet = readFirstSheet(writeWorkbook(rows), { maxRows: 10, maxColumns: 50 });
    expect(sheet.rows).toHaveLength(10);
    expect(sheet.truncated).toBe(true);
  });

  it('flags a column past the limit', () => {
    const wide = [Array.from({ length: 52 }, (_, i) => `c${String(i)}`)];
    expect(readFirstSheet(writeWorkbook(wide), LIMITS).tooWide).toBe(true);
  });

  it.each([
    ['plain text renamed .xlsx', Buffer.from('Roll No,Name\nEC1,A\n')],
    ['an empty file', Buffer.alloc(0)],
    ['a truncated workbook', writeWorkbook([['a']]).subarray(0, 60)],
    ['a ZIP that is not a workbook', zip(new Map([['readme.txt', 'hello']]), true)],
  ])('refuses %s as a format error', (_label, bytes) => {
    expect(() => readFirstSheet(bytes, LIMITS)).toThrow(ZipFormatError);
  });

  it('refuses a part that inflates past the cap (a zip bomb)', () => {
    const huge = Buffer.alloc(MAX_ENTRY_BYTES + 1024, 0x20);
    const bomb = zip(
      new Map<string, string | Buffer>([
        ['[Content_Types].xml', '<Types/>'],
        ['xl/workbook.xml', '<workbook><sheets><sheet name="S" r:id="rId1"/></sheets></workbook>'],
        ['xl/worksheets/sheet1.xml', huge],
      ]),
      true,
    );
    expect(bomb.length).toBeLessThan(700 * 1024);
    expect(() => readFirstSheet(bomb, LIMITS)).toThrow(ZipFormatError);
  });
});

describe('the small pieces', () => {
  it('decodes the five entities and numeric references', () => {
    expect(decodeXml('&amp;&lt;&gt;&quot;&apos;&#65;&#x42;')).toBe('&<>"\'AB');
  });

  it('turns a cell reference into a column index', () => {
    expect(columnIndex('A1')).toBe(0);
    expect(columnIndex('Z9')).toBe(25);
    expect(columnIndex('AA10')).toBe(26);
    expect(columnIndex('AX1')).toBe(49);
    expect(columnIndex('1')).toBeUndefined();
  });
});
