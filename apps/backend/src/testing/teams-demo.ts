import type { Principal } from '../modules/auth/types.js';
import type { TeamsModule } from '../modules/teams/wiring.js';

/**
 * WP-18 step 7: 12 synthetic teams over the 60 demo students (D-33).
 *
 * - Teams 1–12 take four students each, in roll-number order; the first is lead.
 * - `DEMO0001` also joins teams 2 and 3, so one student is in three teams.
 * - Every even team has a co-mentor.
 * - Targets are chosen from what the members hold — one Covered skill, one Thin
 *   skill where there is one — plus "Verilog", which no demo student has, so
 *   all three of R94's states appear.
 */

export const DEMO_TEAM_NAMES = [
  'Byte Busters',
  'Circuit Breakers',
  'Code Crafters',
  'Data Dynamos',
  'Debug Divas',
  'Kernel Knights',
  'Logic Lords',
  'Null Pointers',
  'Pixel Pioneers',
  'Quantum Quokkas',
  'Stack Smashers',
  'Syntax Squad',
] as const;

const ROLES = ['Backend', 'Frontend', 'Design', 'Pitch'] as const;

export function seedDemoTeams(
  teams: TeamsModule,
  studentIds: readonly string[],
  primary: Principal,
  coMentor: Principal,
): number {
  const context = { actor: primary };
  DEMO_TEAM_NAMES.forEach((name, index) => {
    const members: { studentId: string; roleLabel: string | null; isLead: boolean }[] = studentIds
      .slice(index * 4, index * 4 + 4)
      .map((studentId, slot) => ({
        studentId,
        roleLabel: ROLES[slot] ?? null,
        isLead: slot === 0,
      }));
    const shared = studentIds[0];
    if ((index === 1 || index === 2) && shared !== undefined) {
      members.push({ studentId: shared, roleLabel: 'Mentor buddy', isLead: false });
    }
    let team = teams.records.create(context, { name, targets: [], members });
    const covered = team.coverage.chips.find((chip) => chip.state === 'COVERED');
    const thin = team.coverage.chips.find((chip) => chip.state === 'THIN');
    const targets = [covered?.name, thin?.name, 'Verilog'].filter(
      (target): target is string => target !== undefined,
    );
    team = teams.records.update(context, team.id, { targets, version: team.version });
    if (index % 2 === 1) {
      teams.mentors.add(context, team.id, { userId: coMentor.id, version: team.version });
    }
  });
  return DEMO_TEAM_NAMES.length;
}
