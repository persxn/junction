import { ENGAGEMENT_STATUSES, type EngagementStatus } from '@compintel/contracts';

import type { Principal } from '../modules/auth/types.js';
import type { EngagementsModule } from '../modules/engagements/wiring.js';

/**
 * WP-19 step 7: 20 synthetic competitions over the demo teams, students and
 * events (D-33) — the 12 teams on one event each, and 8 individual entries for
 * students in no team — with every status represented, each reached by real
 * moves through R97's machine so its history reads like a real one.
 */

export const DEMO_COMPETITIONS = 20;

/** How to reach each status from a fresh assignment. */
const PATHS: Readonly<Record<EngagementStatus, readonly EngagementStatus[]>> = {
  CONSIDERING: [],
  ASSIGNED: [],
  APPLIED: ['APPLIED'],
  PARTICIPATING: ['APPLIED', 'PARTICIPATING'],
  COMPLETED: ['APPLIED', 'PARTICIPATING', 'COMPLETED'],
  WITHDRAWN: ['WITHDRAWN'],
  NOT_SELECTED: ['APPLIED', 'NOT_SELECTED'],
};

export interface DemoCompetitionInput {
  readonly teamIds: readonly string[];
  /** Students in no team, for the individual entries. */
  readonly loneStudentIds: readonly string[];
  readonly eventIds: readonly string[];
  readonly professor: Principal;
}

export function seedDemoCompetitions(
  competitions: EngagementsModule,
  input: DemoCompetitionInput,
): number {
  if (input.eventIds.length === 0) return 0;
  const context = { actor: input.professor };
  const event = (index: number): string => input.eventIds[index % input.eventIds.length] ?? '';
  const targets = [
    ...input.teamIds.map((teamId, index) => ({ eventId: event(index), teamId })),
    ...input.loneStudentIds.map((studentId, index) => ({
      eventId: event(index),
      studentIds: [studentId],
    })),
  ].slice(0, DEMO_COMPETITIONS);
  targets.forEach((target, index) => {
    const status = ENGAGEMENT_STATUSES[index % ENGAGEMENT_STATUSES.length] ?? 'ASSIGNED';
    const [made] = competitions.assign.assign(context, {
      ...target,
      initialStatus: status === 'CONSIDERING' ? 'CONSIDERING' : 'ASSIGNED',
    }).competitions;
    if (made === undefined) return;
    let version = made.version;
    for (const to of PATHS[status]) {
      version = competitions.records.transition(context, made.id, { to, version }).version;
    }
  });
  return targets.length;
}
