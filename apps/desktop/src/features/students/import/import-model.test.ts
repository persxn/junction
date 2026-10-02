import { describe, expect, it } from 'vitest';

import { IMPORT_PREVIEW } from '../../../testing/students-api.js';
import {
  canCommit,
  errorText,
  filterRows,
  mappingOf,
  minutesLeft,
  shownFields,
  withField,
} from './import-model.js';

describe('the preview rows', () => {
  it('filters to the rows with errors, the new ones and the updates', () => {
    const rows = IMPORT_PREVIEW.rows;
    expect(filterRows(rows, 'ALL')).toHaveLength(3);
    expect(filterRows(rows, 'ERRORS').map((row) => row.rowNumber)).toEqual([4]);
    // A row with an error is not "new": it will not be imported.
    expect(filterRows(rows, 'CREATE').map((row) => row.rowNumber)).toEqual([2, 3]);
    expect(filterRows(rows, 'UPDATE')).toEqual([]);
  });

  it('shows only the mapped fields, in file order', () => {
    expect(shownFields(IMPORT_PREVIEW.columns)).toEqual(['universityId', 'fullName', 'program']);
  });

  it('writes an error with its field in words', () => {
    expect(errorText({ field: 'program', message: 'is wrong' })).toBe('Programme: is wrong');
    expect(errorText({ field: 'row', message: 'Duplicate row' })).toBe('Duplicate row');
  });
});

describe('the mapping', () => {
  it('a change marks the column as chosen, and the request names every column', () => {
    const columns = withField(IMPORT_PREVIEW.columns, 3, 'notes');
    expect(columns[3]).toMatchObject({ field: 'notes', guessed: false });
    expect(mappingOf(columns)).toEqual([
      { index: 0, field: 'universityId' },
      { index: 1, field: 'fullName' },
      { index: 2, field: 'program' },
      { index: 3, field: 'notes' },
    ]);
  });
});

describe('canCommit', () => {
  const base = { mappingErrors: 0, applicable: 2, privacyNoticeShown: true, creates: 2 };
  it('needs a clean mapping, something to apply and — for new students — the notice', () => {
    expect(canCommit(base)).toBe(true);
    expect(canCommit({ ...base, mappingErrors: 1 })).toBe(false);
    expect(canCommit({ ...base, applicable: 0 })).toBe(false);
    expect(canCommit({ ...base, privacyNoticeShown: false })).toBe(false);
    expect(canCommit({ ...base, privacyNoticeShown: false, creates: 0 })).toBe(true);
  });
});

describe('minutesLeft', () => {
  it('says how long the preview is kept', () => {
    const now = Date.parse('2026-10-02T10:00:00Z');
    expect(minutesLeft('2026-10-02T10:30:00Z', now)).toBe('30 minutes');
    expect(minutesLeft('2026-10-02T10:01:30Z', now)).toBe('1 minute');
    expect(minutesLeft('2026-10-02T10:00:20Z', now)).toBe('under a minute');
  });
});
