import { PROGRAM_LABELS, type StudentProgram } from '@compintel/contracts';

import type { Principal } from '../modules/auth/types.js';
import type { StudentsModule } from '../modules/students/wiring.js';

/**
 * Synthetic students (D-33: synthetic data only) — WP-17 step 7.
 *
 * One deterministic generator feeds three things: `pnpm seed:demo --students`,
 * the tests, and the committed `import-500.csv` fixture, whose 50 UPDATE and 10
 * SKIP rows are written against exactly these 60 students. Names are invented,
 * e-mail addresses are `@example.edu`, roll numbers are `DEMO0001…`.
 */

export interface DemoStudent {
  readonly universityId: string;
  readonly fullName: string;
  readonly institutionalEmail: string;
  readonly program: StudentProgram;
  readonly branch: string;
  readonly graduationYear: number;
  readonly skills: readonly { name: string; proficiency: 1 | 2 | 3 }[];
  readonly interests: readonly string[];
}

const FIRST = [
  'Aarav',
  'Diya',
  'Ishaan',
  'Ananya',
  'Kabir',
  'Meera',
  'Rohan',
  'Saanvi',
  'Vivaan',
  'Aditi',
  'Arjun',
  'Kavya',
  'Nikhil',
  'Pooja',
  'Rahul',
  'Sneha',
  'Tanvi',
  'Varun',
  'Zoya',
  'Harsh',
];
const LAST = [
  'Sharma',
  'Iyer',
  'Reddy',
  'Nair',
  'Gupta',
  'Patel',
  'Das',
  'Menon',
  'Khan',
  'Singh',
  'Rao',
  'Joshi',
  'Pillai',
  'Banerjee',
  'Kulkarni',
];
const BRANCHES = ['Computer Science', 'Data Science', 'Artificial Intelligence'];
const SKILLS = [
  'Python',
  'Java',
  'C++',
  'React',
  'Machine Learning',
  'Cloud',
  'Cybersecurity',
  'Android',
  'Figma',
  'SQL',
];
const INTERESTS = ['Hackathons', 'CTF', 'Open Source', 'Robotics', 'Fintech', 'Healthtech'];
const PROGRAMS: readonly StudentProgram[] = ['BTECH', 'BTECH', 'BTECH', 'MTECH', 'MCA'];

/** mulberry32: a tiny seeded PRNG, so every run produces the same people. */
export function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function person(random: () => number, index: number, prefix: string): DemoStudent {
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)] as T;
  const first = pick(FIRST);
  const last = pick(LAST);
  const number = String(index).padStart(4, '0');
  const skillCount = 1 + Math.floor(random() * 3);
  const skills = new Map<string, 1 | 2 | 3>();
  while (skills.size < skillCount)
    skills.set(pick(SKILLS), (1 + Math.floor(random() * 3)) as 1 | 2 | 3);
  return {
    universityId: `${prefix}${number}`,
    fullName: `${first} ${last}`,
    institutionalEmail: `${first}.${last}.${prefix}${number}@example.edu`.toLowerCase(),
    program: pick(PROGRAMS),
    branch: pick(BRANCHES),
    graduationYear: 2026 + Math.floor(random() * 4),
    skills: [...skills].map(([name, proficiency]) => ({ name, proficiency })),
    interests: [pick(INTERESTS)],
  };
}

/** The 60 demo students, DEMO0001…DEMO0060. */
export function demoStudents(count = 60): DemoStudent[] {
  const random = prng(17);
  return Array.from({ length: count }, (_, index) => person(random, index + 1, 'DEMO'));
}

/** Creates the demo students through the real services, mentored by `mentor`. */
export function seedDemoStudents(module: StudentsModule, mentor: Principal): number {
  const context = { actor: mentor };
  for (const spec of demoStudents()) {
    const created = module.records.create(context, {
      universityId: spec.universityId,
      fullName: spec.fullName,
      institutionalEmail: spec.institutionalEmail,
      program: spec.program,
      branch: spec.branch,
      graduationYear: spec.graduationYear,
      privacyNoticeShown: true,
      mentorMe: true,
    });
    module.relations.setTags(context, created.id, {
      version: created.version,
      tags: [
        ...spec.skills.map((skill) => ({
          name: skill.name,
          relation: 'SKILL' as const,
          proficiency: skill.proficiency,
        })),
        ...spec.interests.map((name) => ({
          name,
          relation: 'INTEREST' as const,
          proficiency: null,
        })),
      ],
    });
  }
  return 60;
}

// ---- The import-500 fixture -----------------------------------------------------------

export const IMPORT_500_HEADER = [
  'Roll No.',
  'Name',
  'College Email',
  'Programme',
  'Branch',
  'Dept',
  'Batch',
  'Skills',
  'Interests',
  'Notes',
  'Hostel',
];

const csvCell = (value: string): string =>
  /[",\n\r;]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

function asRow(spec: DemoStudent, overrides: Partial<Record<string, string>> = {}): string[] {
  const base: Record<string, string> = {
    roll: spec.universityId,
    name: spec.fullName,
    email: spec.institutionalEmail,
    program: PROGRAM_LABELS[spec.program],
    branch: spec.branch,
    dept: 'CSE',
    batch: String(spec.graduationYear),
    skills: spec.skills.map((skill) => `${skill.name}:${String(skill.proficiency)}`).join('; '),
    interests: spec.interests.join('; '),
    notes: '',
    hostel: 'Block A',
    ...overrides,
  };
  return [
    base.roll,
    base.name,
    base.email,
    base.program,
    base.branch,
    base.dept,
    base.batch,
    base.skills,
    base.interests,
    base.notes,
    base.hostel,
  ].map((cell) => cell ?? '');
}

/** The ten rules the 40 error rows break, four rows each, and the field each names. */
export const IMPORT_500_ERROR_RULES = [
  { field: 'universityId', overrides: { roll: '' } },
  { field: 'universityId', overrides: { roll: 'NEW0001' } },
  { field: 'institutionalEmail', overrides: { email: 'not-an-email' } },
  { field: 'program', overrides: { program: 'Diploma' } },
  { field: 'graduationYear', overrides: { batch: 'twenty' } },
  { field: 'homeDepartment', overrides: { dept: 'MECH' } },
  { field: 'skills', overrides: { skills: 'Python:5' } },
  { field: 'fullName', overrides: { name: 'X'.repeat(201) } },
  { field: 'fullName', overrides: { name: '' } },
  { field: 'program', overrides: { program: '' } },
] as const;

/**
 * The 500 data rows: 400 new students, 50 changed demo students (a new branch),
 * 10 unchanged ones, and 40 rows that each break one rule. Error row `k` sits at
 * position `12k`, so errors are scattered through the file rather than bunched.
 */
export function import500Rows(): string[][] {
  const random = prng(91);
  const creates = Array.from({ length: 400 }, (_, i) => asRow(person(random, i + 1, 'NEW')));
  const demo = demoStudents();
  const updates = demo
    .slice(0, 50)
    .map((spec) => asRow(spec, { branch: 'Information Technology' }));
  const skips = demo.slice(50, 60).map((spec) => asRow(spec));
  const errors = Array.from({ length: 40 }, (_, k) => {
    const rule = IMPORT_500_ERROR_RULES[k % IMPORT_500_ERROR_RULES.length];
    const spec = person(random, k + 1, 'ERR');
    return asRow(spec, rule?.overrides ?? {});
  });
  const rows = [...creates, ...updates, ...skips];
  errors.forEach((row, k) => {
    rows.splice(12 * (k + 1), 0, row);
  });
  return rows;
}

/** `import-500.csv`, byte for byte (LF — `.gitattributes` keeps every text file LF). */
export function import500Csv(): string {
  return [IMPORT_500_HEADER, ...import500Rows()]
    .map((row) => row.map(csvCell).join(','))
    .join('\n')
    .concat('\n');
}
