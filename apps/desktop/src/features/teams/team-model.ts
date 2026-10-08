import type { CoverageCounts, TeamDetail, TeamMember } from '@compintel/contracts';

/**
 * The Teams screens' pure parts: coverage in words, why a control is disabled,
 * and what Undo of a removal re-adds. No React here.
 */

/** "3 covered · 1 thin · 2 missing"; "No skills yet" when there is nothing to count. */
export function coverageText(counts: CoverageCounts): string {
  const parts = [
    counts.covered > 0 ? `${String(counts.covered)} covered` : '',
    counts.thin > 0 ? `${String(counts.thin)} thin` : '',
    counts.missing > 0 ? `${String(counts.missing)} missing` : '',
  ].filter((part) => part !== '');
  return parts.length === 0 ? 'No skills yet' : parts.join(' · ');
}

export type TeamControl = 'edit' | 'archive' | 'manageMentors' | 'transferPrimary';

/**
 * Why a control is off, in words — or `undefined` when it is on. §10.1 makes
 * the UI's view cosmetic, so a control the user may not use is disabled and
 * explained rather than hidden (WP-18 step 6).
 */
export function disabledReason(team: TeamDetail, control: TeamControl): string | undefined {
  if (team.status === 'ARCHIVED' && control !== 'archive') {
    return 'This team is archived. Unarchive it to make changes.';
  }
  if (team.can[control]) return undefined;
  switch (control) {
    case 'edit':
      return 'Only this team’s mentors or an administrator can change it.';
    case 'archive':
      return 'Only the primary mentor or an administrator can archive this team.';
    case 'manageMentors':
      return 'Only the primary mentor or an administrator can add or remove mentors.';
    case 'transferPrimary':
      return 'Only the primary mentor or an administrator can hand the team over.';
  }
}

/** What Undo of "remove" sends: the same student, with the same role and lead. */
export function readdOf(member: TeamMember): {
  studentId: string;
  roleLabel: string | null;
  isLead: boolean;
} {
  return { studentId: member.studentId, roleLabel: member.roleLabel, isLead: member.isLead };
}

/** "Also in 2 teams", or nothing for a student in none. */
export function alsoIn(teamCount: number): string | undefined {
  if (teamCount === 0) return undefined;
  return teamCount === 1 ? 'Also in 1 team' : `Also in ${String(teamCount)} teams`;
}

/** Targets typed as "Python, SQL; Figma" → distinct, trimmed names. */
export function parseTargets(text: string): string[] {
  const seen = new Map<string, string>();
  for (const part of text.split(/[;,]/)) {
    const name = part.trim().replace(/\s+/g, ' ');
    if (name !== '' && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
  }
  return [...seen.values()];
}
