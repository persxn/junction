import type { CoverageChip, CoverageState, TeamCoverage } from '@compintel/contracts';

/**
 * R94's skill coverage, as one pure function.
 *
 * Over ACTIVE students with an open membership only:
 * - **Covered**: two or more members hold the skill, or one holds it at
 *   proficiency 2 (Intermediate) or above;
 * - **Thin**: exactly one member holds it, at 1 (Beginner) or unrated;
 * - **Missing**: a target no member holds.
 *
 * With targets, the chips are the targets. Without, they are the members'
 * skills — which are held by someone by definition, so never Missing. No AI is
 * involved (D-15): a professor can check every chip by hand.
 */

export interface CoverageMember {
  readonly active: boolean;
  readonly skills: readonly { readonly name: string; readonly proficiency: number | null }[];
}

/** Skill names compare trimmed and case-insensitive, like tag names everywhere. */
const keyOf = (name: string): string => name.trim().toLowerCase();

export function stateOf(holders: number, best: number | null): CoverageState {
  if (holders === 0) return 'MISSING';
  if (holders >= 2 || (best ?? 0) >= 2) return 'COVERED';
  return 'THIN';
}

const ORDER: Readonly<Record<CoverageState, number>> = { MISSING: 0, THIN: 1, COVERED: 2 };

export function coverage(
  members: readonly CoverageMember[],
  targets: readonly string[],
): TeamCoverage {
  const held = new Map<string, { name: string; holders: number; best: number | null }>();
  for (const member of members) {
    if (!member.active) continue;
    const seen = new Set<string>();
    for (const skill of member.skills) {
      const key = keyOf(skill.name);
      if (seen.has(key)) continue;
      seen.add(key);
      const entry = held.get(key) ?? { name: skill.name, holders: 0, best: null };
      entry.holders += 1;
      if (skill.proficiency !== null && (entry.best === null || skill.proficiency > entry.best)) {
        entry.best = skill.proficiency;
      }
      held.set(key, entry);
    }
  }

  const chips: CoverageChip[] =
    targets.length > 0
      ? [...new Map(targets.map((name) => [keyOf(name), name])).entries()].map(([key, name]) => {
          const entry = held.get(key);
          return {
            name,
            state: stateOf(entry?.holders ?? 0, entry?.best ?? null),
            holders: entry?.holders ?? 0,
            isTarget: true,
          };
        })
      : [...held.values()].map((entry) => ({
          name: entry.name,
          state: stateOf(entry.holders, entry.best),
          holders: entry.holders,
          isTarget: false,
        }));

  // Gaps first: what a mentor acts on is what is missing or thin.
  chips.sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.name.localeCompare(b.name));
  return {
    chips,
    counts: {
      covered: chips.filter((chip) => chip.state === 'COVERED').length,
      thin: chips.filter((chip) => chip.state === 'THIN').length,
      missing: chips.filter((chip) => chip.state === 'MISSING').length,
    },
  };
}

/** R95: names compare trimmed and case-insensitive. */
export function teamNameKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** An audit summary's name for a team: its name is not personal data. */
export function teamRef(name: string): string {
  return `team “${name}”`;
}
