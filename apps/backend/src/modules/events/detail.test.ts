import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadScenario, openEventsHarness, type EventsHarness } from '../../testing/events.js';
import type { Principal } from '../auth/types.js';

/**
 * `GET /events/:id/detail` on the WP-16b conflict fixture — the payload the
 * "Sources disagree" panel is drawn from (§19's acceptance criterion).
 *
 * The three sources agree about everything except the registration deadline,
 * the prize and the team size, so every assertion here is about those three and
 * about the one rule they exist to prove: nothing is averaged, and the value
 * the app selected says why it won.
 */

let h: EventsHarness;
let professor: Principal;

beforeEach(() => {
  h = openEventsHarness('2026-09-01T00:00:00.000Z', { categories: true });
  professor = h.user('PROFESSOR');
});

afterEach(() => {
  h.close();
});

function open(): ReturnType<EventsHarness['module']['detail']['detail']> {
  const [ctftime] = h.ingestScenario(loadScenario('three-sources-disagree', 'conflicts'));
  const event = h.eventOf(ctftime!);
  return h.module.detail.detail({ actor: professor }, event.id);
}

describe('three sources disagree', () => {
  it('is one event carried by three sources, each with its attribution', () => {
    const detail = open();
    expect(detail.sources.map((source) => source.key)).toEqual([
      'hackxyz-site',
      'devfolio',
      'ctftime',
    ]);
    // D-32: the seeded sources carry attribution text; a site added by hand need not.
    expect(detail.sources.find((source) => source.key === 'ctftime')?.attributionText).toBeTypeOf(
      'string',
    );
  });

  it('says the sources disagree', () => {
    expect(open().hasConflicts).toBe(true);
  });

  it.each([
    ['registrationDeadlineAt', 'Registration deadline'],
    ['prizeText', 'Prize'],
    ['teamMax', 'Largest team'],
  ])('lists every claimed value of %s with its source', (field, label) => {
    const conflict = open().conflicts.find((entry) => entry.field === field);
    expect(conflict, field).toBeDefined();
    expect(conflict!.label).toBe(label);
    expect(conflict!.values.map((value) => value.sourceKey).sort()).toEqual([
      'ctftime',
      'devfolio',
      'hackxyz-site',
    ]);
    // Every claimed value is distinct: nothing was merged into an average.
    expect(new Set(conflict!.values.map((value) => JSON.stringify(value.value))).size).toBe(3);
  });

  it('marks the selected value with the reason it won (§7.5)', () => {
    const detail = open();
    const deadline = detail.conflicts.find((entry) => entry.field === 'registrationDeadlineAt');
    expect(deadline?.selected).toBe(Date.parse('2026-11-13T18:29:00Z'));
    expect(deadline?.selectedReason).toBe('HIGHEST_TRUST');
    expect(deadline?.selectedSourceName).toBe('hackxyz-site');
    // The selected value is byte-for-byte one of the claims, never a new number.
    expect(deadline?.values.some((value) => value.value === deadline.selected)).toBe(true);
  });

  it('marks exactly one claim as the selected one, even when two sources agree', () => {
    // The site and Devfolio both say the smallest team is 2; CTFtime says 3.
    // Marking "the selected value" would tick two rows — only one claim won.
    const teamMin = open().conflicts.find((entry) => entry.field === 'teamMin');
    expect(teamMin?.values.filter((value) => value.value === 2)).toHaveLength(2);
    const winner = teamMin?.values.filter(
      (value) => value.sourceRecordId === teamMin.selectedSourceRecordId,
    );
    expect(winner).toHaveLength(1);
    expect(winner?.[0]?.sourceKey).toBe('hackxyz-site');
  });

  it('calls the date and team disagreements material and the prize wording not', () => {
    const detail = open();
    const material = new Map(
      detail.conflicts.map((entry) => [entry.field, entry.material] as const),
    );
    expect(material.get('registrationDeadlineAt')).toBe(true);
    expect(material.get('teamMin')).toBe(true);
    expect(material.get('teamMax')).toBe(true);
    // §7.5's list is dates, team size, fee and mode; a prize *wording* is shown
    // but does not on its own make the event contested.
    expect(material.get('prizeText')).toBe(false);
  });

  it('groups the claims by field, best first, with the selected one marked', () => {
    const detail = open();
    const group = detail.claims.find((entry) => entry.field === 'teamMax');
    expect(group?.claims.map((claim) => claim.value)).toEqual([4, 5, 6]);
    expect(group?.claims.map((claim) => claim.sourceName)).toEqual([
      'hackxyz-site',
      'Devfolio',
      'CTFtime',
    ]);
    expect(group?.claims.filter((claim) => claim.isSelected)).toHaveLength(1);
    expect(group?.claims.find((claim) => claim.isSelected)?.value).toBe(4);
    expect(group?.selectedReason).toBe('HIGHEST_TRUST');
    expect(group?.verifiedAt).toBe(Date.parse('2026-09-01T00:00:00.000Z'));
  });

  it('carries the deadlines, the categories and an empty first history page', () => {
    const detail = open();
    expect(detail.deadlines.map((deadline) => deadline.kind)).toContain('REGISTRATION');
    // The title says "AI Hackathon", so WP-15b's starter rules give it a category.
    expect(detail.categories.map((category) => category.slug)).toContain('ai-ml');
    expect(detail.categories.every((category) => !category.isSuppressed)).toBe(true);
    // Each later source re-resolved the event, so the history has real rows —
    // rendered as words, newest first, with no enum value on the screen.
    expect(detail.history.items.length).toBeGreaterThan(0);
    expect(detail.history.items.map((entry) => entry.causeLabel)).toContain('Found by a scrape');
    expect(detail.history.items.map((entry) => entry.fieldLabel)).toContain('Prize');
    const ids = detail.history.items.map((entry) => entry.id);
    expect([...ids].sort().reverse()).toEqual(ids);
  });
});

describe('an event the sources agree about', () => {
  it('has no conflicts and still explains where each fact came from', () => {
    const [record] = h.ingestScenario(loadScenario('yearly-editions-never-merge'));
    const event = h.eventOf(record!);
    const detail = h.module.detail.detail({ actor: professor }, event.id);
    expect(detail.hasConflicts).toBe(false);
    expect(detail.conflicts).toEqual([]);
    const title = detail.claims.find((group) => group.field === 'title');
    expect(title?.selectedReason).toBe('ONLY_SOURCE');
    expect(title?.claims).toHaveLength(1);
  });

  it('answers 404 for an event nobody may see', () => {
    expect(() => h.module.detail.detail({ actor: professor }, 'no-such-event')).toThrow(
      /There is no event with the id/,
    );
  });
});
