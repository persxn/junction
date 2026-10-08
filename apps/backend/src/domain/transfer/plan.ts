import {
  MENTOR_ROLE_LABELS,
  type EngagementStatus,
  type MentorRole,
  type TeamStatus,
  type TransferItem,
} from '@compintel/contracts';

import { isTerminal } from '../engagements/status.js';

/**
 * Ruling R105, pure (WP-21): which of one professor's active mentor rows move
 * to another, and how. Given the rows and their parents, it returns the exact
 * closes and opens — all at one instant, the caller's `now` — what stays as
 * history, the before → after sentences, and the parts the preview token
 * hashes. Nothing here reads or writes anything.
 */

export interface MentorRow {
  readonly id: string;
  readonly userId: string;
  readonly role: MentorRole;
}

export interface TeamInput {
  readonly id: string;
  readonly name: string;
  readonly status: TeamStatus;
  readonly version: number;
  /** Active rows only (`to_at` null). */
  readonly mentors: readonly MentorRow[];
}

export interface CompetitionInput {
  readonly id: string;
  readonly name: string;
  readonly status: EngagementStatus;
  readonly version: number;
  readonly mentors: readonly MentorRow[];
}

export interface MentorshipInput {
  readonly id: string;
  readonly studentId: string;
  readonly studentName: string;
  readonly mentorUserId: string;
}

export interface Person {
  readonly userId: string;
  readonly displayName: string;
}

export type MentorTable = 'team_mentors' | 'engagement_mentors' | 'mentorships';

export interface Close {
  readonly table: MentorTable;
  readonly rowId: string;
  /** The team, competition or student, for the audit row. */
  readonly entityId: string;
}

export interface Open {
  readonly table: MentorTable;
  readonly entityId: string;
  readonly userId: string;
  /** Null for a mentorship, which has no role. */
  readonly role: MentorRole | null;
}

export interface TransferPlan {
  readonly closes: readonly Close[];
  readonly opens: readonly Open[];
  readonly teams: readonly TransferItem[];
  readonly competitions: readonly TransferItem[];
  readonly mentorships: readonly TransferItem[];
  readonly staysWith: readonly TransferItem[];
  /** Teams and competitions whose `version` the commit bumps. */
  readonly touchedTeams: readonly string[];
  readonly touchedCompetitions: readonly string[];
  /** What the preview token hashes: every affected row with its parent's version. */
  readonly tokenParts: readonly string[];
  readonly at: number;
}

const role = (value: MentorRole): string => MENTOR_ROLE_LABELS[value].toLowerCase();

interface ParentResult {
  readonly closes: Close[];
  readonly opens: Open[];
  readonly sentence: string;
}

/** One team's or competition's move (R105's collision rules). */
function moveParent(
  table: 'team_mentors' | 'engagement_mentors',
  parentId: string,
  mentors: readonly MentorRow[],
  from: Person,
  to: Person,
): ParentResult | undefined {
  const mine = mentors.find((row) => row.userId === from.userId);
  if (mine === undefined) return undefined;
  const theirs = mentors.find((row) => row.userId === to.userId);
  const closeMine: Close = { table, rowId: mine.id, entityId: parentId };
  if (theirs === undefined) {
    return {
      closes: [closeMine],
      opens: [{ table, entityId: parentId, userId: to.userId, role: mine.role }],
      sentence: `${from.displayName} (${role(mine.role)}) → ${to.displayName} (${role(mine.role)})`,
    };
  }
  if (mine.role === 'PRIMARY' && theirs.role === 'CO_MENTOR') {
    // One PRIMARY is always active: the co-mentor row closes and a PRIMARY one opens.
    return {
      closes: [closeMine, { table, rowId: theirs.id, entityId: parentId }],
      opens: [{ table, entityId: parentId, userId: to.userId, role: 'PRIMARY' }],
      sentence: `${from.displayName} (${role('PRIMARY')}) → ${to.displayName} (${role('PRIMARY')}, was ${role('CO_MENTOR')})`,
    };
  }
  return {
    closes: [closeMine],
    opens: [],
    sentence: `${from.displayName} (${role(mine.role)}) steps away; ${to.displayName} stays ${role(theirs.role)}`,
  };
}

const byName = (a: TransferItem, b: TransferItem): number =>
  a.name.localeCompare(b.name) || a.entityId.localeCompare(b.entityId);

export function planTransfer(input: {
  readonly from: Person;
  readonly to: Person;
  readonly teams: readonly TeamInput[];
  readonly competitions: readonly CompetitionInput[];
  readonly mentorships: readonly MentorshipInput[];
  /** The student ids `to` already mentors (open rows). */
  readonly toMentors: ReadonlySet<string>;
  readonly now: number;
}): TransferPlan {
  const { from, to } = input;
  const closes: Close[] = [];
  const opens: Open[] = [];
  const teams: TransferItem[] = [];
  const competitions: TransferItem[] = [];
  const mentorships: TransferItem[] = [];
  const staysWith: TransferItem[] = [];
  const touchedTeams: string[] = [];
  const touchedCompetitions: string[] = [];
  const tokenParts: string[] = [];
  const history = `Stays with ${from.displayName} — history`;

  for (const team of input.teams) {
    if (!team.mentors.some((row) => row.userId === from.userId)) continue;
    if (team.status !== 'ACTIVE') {
      staysWith.push({ kind: 'TEAM', entityId: team.id, name: team.name, sentence: history });
      continue;
    }
    const moved = moveParent('team_mentors', team.id, team.mentors, from, to);
    if (moved === undefined) continue;
    closes.push(...moved.closes);
    opens.push(...moved.opens);
    touchedTeams.push(team.id);
    teams.push({ kind: 'TEAM', entityId: team.id, name: team.name, sentence: moved.sentence });
    for (const close of moved.closes)
      tokenParts.push(`team:${close.rowId}:${String(team.version)}`);
  }

  for (const competition of input.competitions) {
    if (!competition.mentors.some((row) => row.userId === from.userId)) continue;
    if (isTerminal(competition.status)) {
      staysWith.push({
        kind: 'COMPETITION',
        entityId: competition.id,
        name: competition.name,
        sentence: history,
      });
      continue;
    }
    const moved = moveParent('engagement_mentors', competition.id, competition.mentors, from, to);
    if (moved === undefined) continue;
    closes.push(...moved.closes);
    opens.push(...moved.opens);
    touchedCompetitions.push(competition.id);
    competitions.push({
      kind: 'COMPETITION',
      entityId: competition.id,
      name: competition.name,
      sentence: moved.sentence,
    });
    for (const close of moved.closes) {
      tokenParts.push(`competition:${close.rowId}:${String(competition.version)}`);
    }
  }

  for (const mentorship of input.mentorships) {
    if (mentorship.mentorUserId !== from.userId) continue;
    closes.push({ table: 'mentorships', rowId: mentorship.id, entityId: mentorship.studentId });
    const already = input.toMentors.has(mentorship.studentId);
    if (!already) {
      opens.push({
        table: 'mentorships',
        entityId: mentorship.studentId,
        userId: to.userId,
        role: null,
      });
    }
    mentorships.push({
      kind: 'MENTORSHIP',
      entityId: mentorship.studentId,
      name: mentorship.studentName,
      sentence: already
        ? `${from.displayName} steps away; ${to.displayName} already mentors them`
        : `${from.displayName} → ${to.displayName}`,
    });
    tokenParts.push(`mentorship:${mentorship.id}`);
  }

  return {
    closes,
    opens,
    teams: teams.sort(byName),
    competitions: competitions.sort(byName),
    mentorships: mentorships.sort(byName),
    staysWith: staysWith.sort(byName),
    touchedTeams,
    touchedCompetitions,
    tokenParts: tokenParts.sort(),
    at: input.now,
  };
}

/** Nothing moves: the preview is empty and the commit is refused. */
export const isEmptyPlan = (plan: TransferPlan): boolean =>
  plan.teams.length + plan.competitions.length + plan.mentorships.length === 0;
