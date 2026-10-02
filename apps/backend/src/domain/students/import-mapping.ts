import {
  STUDENT_IMPORT_FIELD_LABELS,
  STUDENT_IMPORT_HEADER_ALIASES,
  STUDENT_IMPORT_REQUIRED_FIELDS,
  type StudentImportColumn,
  type StudentImportField,
  type StudentImportFieldError,
  type StudentImportMapping,
} from '@compintel/contracts';

/**
 * Which column feeds which field (ruling R93, WP-17 step 4).
 *
 * A header is matched against a short list of the ways departments actually
 * write it — "Roll No.", "Enrolment", "Reg No", "Programme", "Passing year" —
 * compared without case or punctuation. **A header that matches nothing is
 * listed as "Not imported" and never guessed at**: a wrong guess writes a
 * student's notes into their branch, and nobody reads a preview that closely.
 * Every guess can be overridden, and the override always wins.
 */

/** Lower-case, punctuation to spaces, single-spaced: "Roll No." → "roll no". */
export function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** The accepted headings live in the contracts, so the in-app guide lists exactly these. */
export const HEADER_ALIASES = STUDENT_IMPORT_HEADER_ALIASES;

/** The field a header names, or `undefined` when it names none. */
export function fieldForHeader(header: string): StudentImportField | undefined {
  const key = normalizeHeader(header);
  if (key.length === 0) return undefined;
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.includes(key)) return field as StudentImportField;
  }
  return undefined;
}

export interface MappingOptions {
  /** Q8: while off, a phone column is never imported. */
  readonly phoneEnabled: boolean;
  /** The professor's choices; each entry overrides the guess for its column. */
  readonly override?: StudentImportMapping | undefined;
}

export interface MappingResult {
  readonly columns: readonly StudentImportColumn[];
  readonly unknownColumns: readonly string[];
  readonly errors: readonly StudentImportFieldError[];
}

const label = (field: StudentImportField): string => STUDENT_IMPORT_FIELD_LABELS[field];
const shown = (header: string, index: number): string =>
  header.trim().length > 0 ? `“${header.trim()}”` : `column ${String(index + 1)}`;

/** Maps every column, applies the overrides, and says what is wrong with the result. */
export function mapColumns(headers: readonly string[], options: MappingOptions): MappingResult {
  const overrides = new Map((options.override ?? []).map((entry) => [entry.index, entry.field]));
  const errors: StudentImportFieldError[] = [];
  const columns = headers.map((header, index): StudentImportColumn => {
    if (overrides.has(index)) {
      const field = overrides.get(index) ?? null;
      if (field === 'phone' && !options.phoneEnabled) {
        errors.push({
          field: 'phone',
          message:
            'Phone numbers are not collected — an administrator can switch them on in Campus & settings.',
        });
        return { index, header, field: null, guessed: false };
      }
      return { index, header, field, guessed: false };
    }
    const guess = fieldForHeader(header);
    const field = guess === 'phone' && !options.phoneEnabled ? undefined : guess;
    return { index, header, field: field ?? null, guessed: field !== undefined };
  });

  const byField = new Map<StudentImportField, StudentImportColumn[]>();
  for (const column of columns) {
    if (column.field === null) continue;
    byField.set(column.field, [...(byField.get(column.field) ?? []), column]);
  }
  for (const [field, feeding] of byField) {
    if (feeding.length > 1) {
      errors.push({
        field,
        message: `${feeding.map((column) => shown(column.header, column.index)).join(' and ')} both feed “${label(field)}”. Choose one and mark the other “Not imported”.`,
      });
    }
  }
  for (const field of STUDENT_IMPORT_REQUIRED_FIELDS) {
    if (!byField.has(field)) {
      errors.push({
        field,
        message: `No column feeds “${label(field)}”, which every student needs. Choose the column that holds it.`,
      });
    }
  }
  const unknownColumns = columns
    .filter((column) => column.field === null)
    .map((column) =>
      column.header.trim().length > 0 ? column.header.trim() : shown('', column.index),
    );
  return { columns, unknownColumns, errors };
}
