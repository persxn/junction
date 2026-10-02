import {
  STUDENT_IMPORT_FIELD_LABELS,
  type StudentImportColumn,
  type StudentImportField,
  type StudentImportFieldError,
  type StudentImportMapping,
  type StudentImportRow,
} from '@compintel/contracts';

/**
 * The import wizard's pure parts: the step it is on, filtering and paging the
 * preview rows, and the words for an error. No React here.
 */

export type ImportStep = 'PICK' | 'PREVIEW' | 'RESULT';

/** How many preview rows render at once; "Show more" adds another page. */
export const ROWS_PAGE = 200;

export type RowFilter = 'ALL' | 'ERRORS' | 'CREATE' | 'UPDATE';

export function filterRows(
  rows: readonly StudentImportRow[],
  filter: RowFilter,
): StudentImportRow[] {
  switch (filter) {
    case 'ALL':
      return [...rows];
    case 'ERRORS':
      return rows.filter((row) => row.errors.length > 0);
    case 'CREATE':
      return rows.filter((row) => row.errors.length === 0 && row.action === 'CREATE');
    case 'UPDATE':
      return rows.filter((row) => row.errors.length === 0 && row.action === 'UPDATE');
  }
}

/** The fields the preview table shows as columns: the mapped ones, in file order. */
export function shownFields(columns: readonly StudentImportColumn[]): StudentImportField[] {
  const seen = new Set<StudentImportField>();
  for (const column of columns) if (column.field !== null) seen.add(column.field);
  return [...seen];
}

/** The professor's mapping as the request wants it — every column, mapped or not. */
export function mappingOf(columns: readonly StudentImportColumn[]): StudentImportMapping {
  return columns.map((column) => ({ index: column.index, field: column.field }));
}

export function withField(
  columns: readonly StudentImportColumn[],
  index: number,
  field: StudentImportField | null,
): StudentImportColumn[] {
  return columns.map((column) =>
    column.index === index ? { ...column, field, guessed: false } : column,
  );
}

/** "Roll number: already used by another row (row 7)" — the field in words. */
export function errorText(error: StudentImportFieldError): string {
  return error.field === 'row'
    ? error.message
    : `${STUDENT_IMPORT_FIELD_LABELS[error.field]}: ${error.message}`;
}

export function errorsFor(
  row: StudentImportRow,
  field: StudentImportField | 'row',
): StudentImportFieldError[] {
  return row.errors.filter((error) => error.field === field);
}

/** Whether the commit button may be pressed. */
export function canCommit(input: {
  readonly mappingErrors: number;
  readonly applicable: number;
  readonly privacyNoticeShown: boolean;
  readonly creates: number;
}): boolean {
  if (input.mappingErrors > 0 || input.applicable === 0) return false;
  // New students need the notice acknowledged; a file of updates alone does not.
  return input.creates === 0 || input.privacyNoticeShown;
}

/** "12 minutes", "under a minute" — how long the preview is kept. */
export function minutesLeft(expiresAt: string, now: number): string {
  const minutes = Math.floor((Date.parse(expiresAt) - now) / 60_000);
  if (minutes < 1) return 'under a minute';
  return minutes === 1 ? '1 minute' : `${String(minutes)} minutes`;
}
