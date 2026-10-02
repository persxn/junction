import { PROGRAM_LABELS, STUDENT_PROGRAMS, type StudentProgram } from '@compintel/contracts';

/**
 * Pure rules about one student record (rulings R91–R93). No I/O: the service
 * and the import both call these, so a roll number or a programme means the same
 * thing whichever door it came through.
 */

/**
 * R93's match key: upper-cased, every space removed. "ec 21 001" and "EC21001"
 * are one student; "EC21-001" is a different one (punctuation is part of the
 * number as the university writes it).
 */
export function universityIdKey(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase();
}

/** Letters and digits only, lower-case — how programme spellings are compared. */
function squash(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Spellings people write in a programme column, beyond the enum and its label. */
const PROGRAM_ALIASES: Readonly<Record<string, StudentProgram>> = {
  btech: 'BTECH',
  be: 'BTECH',
  bachelorsoftechnology: 'BTECH',
  bacheloroftechnology: 'BTECH',
  mtech: 'MTECH',
  me: 'MTECH',
  masteroftechnology: 'MTECH',
  bsc: 'BSC',
  bachelorofscience: 'BSC',
  msc: 'MSC',
  masterofscience: 'MSC',
  bca: 'BCA',
  mca: 'MCA',
  phd: 'PHD',
  doctorate: 'PHD',
  other: 'OTHER',
};

/** "B.Tech", "BTech", "btech", "BTECH" → BTECH; anything else → undefined. */
export function parseProgram(raw: string): StudentProgram | undefined {
  const key = squash(raw);
  if (key.length === 0) return undefined;
  const direct = STUDENT_PROGRAMS.find(
    (program) => squash(program) === key || squash(PROGRAM_LABELS[program]) === key,
  );
  return direct ?? PROGRAM_ALIASES[key];
}

/** The allowed programmes in words, for an error message. */
export function programChoices(): string {
  return STUDENT_PROGRAMS.map((program) => PROGRAM_LABELS[program]).join(', ');
}

/**
 * R92: what an audit summary calls a student. Never the name — the audit chain
 * is immutable (R35), so a name written into it could never be erased.
 */
export function studentRef(studentId: string): string {
  return `student ${studentId.slice(0, 8)}`;
}

/** The personal columns R92 keeps out of every audit diff. */
export const PERSONAL_FIELDS = [
  'universityId',
  'fullName',
  'preferredName',
  'institutionalEmail',
  'phone',
  'notes',
  'externalInstitution',
] as const;
export type PersonalField = (typeof PERSONAL_FIELDS)[number];

/** R92's diff value for a personal field that changed. */
export const CHANGED = '<changed>';

/**
 * An audit diff for an edit: each changed field's new value, except a personal
 * field, which is recorded only as having changed.
 */
export function auditDiff(
  changed: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(changed)) {
    out[field] = (PERSONAL_FIELDS as readonly string[]).includes(field) ? CHANGED : value;
  }
  return out;
}

/** "python:3; machine learning" → `[{name: 'python', proficiency: 3}, …]`. */
export interface ParsedTag {
  readonly name: string;
  readonly proficiency: 1 | 2 | 3 | null;
}

export type TagListResult =
  | { readonly ok: true; readonly tags: readonly ParsedTag[] }
  | { readonly ok: false; readonly message: string };

/**
 * A skills or interests cell: names separated by `;` or `,`, each optionally
 * `name:1`–`name:3`. A bad level is an error that says what levels exist; an
 * empty cell is no tags.
 */
export function parseTagList(cell: string): TagListResult {
  const tags: ParsedTag[] = [];
  for (const part of cell.split(/[;,]/)) {
    const entry = part.trim();
    if (entry.length === 0) continue;
    const colon = entry.lastIndexOf(':');
    const name = (colon === -1 ? entry : entry.slice(0, colon)).trim();
    const level = colon === -1 ? '' : entry.slice(colon + 1).trim();
    if (name.length === 0 || name.length > 60) {
      return { ok: false, message: `“${entry}” is not a tag name (1–60 characters).` };
    }
    if (level === '') {
      tags.push({ name, proficiency: null });
      continue;
    }
    if (level !== '1' && level !== '2' && level !== '3') {
      return {
        ok: false,
        message: `“${entry}”: a level is 1 (Beginner), 2 (Intermediate) or 3 (Advanced).`,
      };
    }
    tags.push({ name, proficiency: Number(level) as 1 | 2 | 3 });
  }
  return { ok: true, tags };
}
