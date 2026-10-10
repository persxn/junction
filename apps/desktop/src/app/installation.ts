import { isStudentMode, type InstallationMode, type RoleKey } from '@compintel/contracts';

import { use } from 'react';

import { AuthContext } from '../auth/auth-context.js';

/**
 * What kind of install this is, and the words that follow from it (WP-34,
 * rulings R130 and R135).
 *
 * Components ask this hook instead of comparing the raw mode string, so a label
 * changes in one place: a student install says "Teammates" for students and
 * "Owner" for a team's primary mentor, and never offers the Professor role.
 */

export interface Installation {
  readonly mode: InstallationMode;
  readonly isStudent: boolean;
  /** "Myself": one profile, no account administration (R133). */
  readonly isIndividual: boolean;
  readonly isGuest: boolean;
  readonly labels: InstallationLabels;
  /** The roles an administrator may hand out here (R131). */
  readonly grantableRoles: readonly RoleKey[];
}

export interface InstallationLabels {
  /** The Students rail item and page title. */
  readonly students: string;
  readonly student: string;
  /** A team's or competition's PRIMARY mentor row. */
  readonly primaryMentor: string;
  readonly coMentor: string;
  readonly mentors: string;
  /** Whose achievements Insights counts: "your department", "you", or the group. */
  readonly insightsOwner: string;
  /** Insights' per-person chart, and what it says when it is empty. */
  readonly mentorLoad: string;
  readonly mentoring: string;
  /** The Students page's empty-list line. */
  readonly studentsIntro: string;
}

const DEPARTMENT_LABELS: InstallationLabels = {
  students: 'Students',
  student: 'Student',
  primaryMentor: 'Primary mentor',
  coMentor: 'Co-mentor',
  mentors: 'Mentors',
  insightsOwner: 'your department',
  mentorLoad: 'Mentor load',
  mentoring: 'mentoring',
  studentsIntro: 'Every student of the institution, with their skills and mentors.',
};

const STUDENT_LABELS: InstallationLabels = {
  students: 'Teammates',
  student: 'Teammate',
  primaryMentor: 'Owner',
  coMentor: 'Co-owner',
  mentors: 'Owners',
  insightsOwner: 'you',
  mentorLoad: 'Who owns what',
  mentoring: 'owning',
  studentsIntro: 'Everyone you compete with, with their skills and teams.',
};

/** Pure, for tests and for code outside React. */
export function installationFor(mode: InstallationMode | undefined, isGuest = false): Installation {
  const resolved = mode ?? 'DEPARTMENT';
  const student = isStudentMode(resolved);
  return {
    mode: resolved,
    isStudent: student,
    isIndividual: resolved === 'STUDENT_INDIVIDUAL',
    isGuest,
    labels: student ? STUDENT_LABELS : DEPARTMENT_LABELS,
    grantableRoles: student ? ['STUDENT', 'ADMINISTRATOR'] : ['ADMINISTRATOR', 'PROFESSOR'],
  };
}

/** Outside a signed-in tree (a dialog under test, the wizard) it is a department install. */
export function useInstallation(): Installation {
  const me = use(AuthContext)?.me;
  return installationFor(me?.mode, me?.user.isGuest === true);
}
