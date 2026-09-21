import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { eventFieldClaims } from '../../db/schema/index.js';
import { runScrape } from '../../scraping/run.js';
import { CTFTIME_CAPTURE_CLOCK } from '../../testing/ctftime.js';
import { openCtftimeRun, recordedTransport } from '../../testing/ctftime-run.js';
import { loadScenario, openEventsHarness, type EventsHarness } from '../../testing/events.js';
import { fixturesDir } from '../../testing/golden.js';
import type { Principal } from '../auth/types.js';
import { createEventsModule } from './wiring.js';
import { AuditLog } from '../../platform/audit.js';
import { SettingsStore } from '../../platform/settings.js';
import { silentLogger } from '../../testing/scraping.js';
import { openTestGeo } from '../../testing/ctftime.js';

/**
 * The four §19 scenarios of WP-10, each `describe` named after its fixture in
 * `test/fixtures/dedup/`, so WP-16b can reuse them by name.
 */

let h: EventsHarness;
let admin: Principal;

beforeEach(() => {
  h = openEventsHarness();
  admin = h.user('ADMINISTRATOR');
});

afterEach(() => {
  h.close();
});

function adminContext(): { actor: Principal } {
  return { actor: admin };
}

describe('same event on three sources', () => {
  it('is one event with three source records', () => {
    const [ctftime, devfolio, site] = h.ingestScenario(loadScenario('same-event-on-three-sources'));
    const event = h.eventOf(ctftime!);
    expect(h.eventOf(devfolio!).id).toBe(event.id);
    expect(h.eventOf(site!).id).toBe(event.id);
    expect(h.module.provenance.recordsOf(event.id)).toHaveLength(3);
    expect(h.module.events.allEvents()).toHaveLength(1);
    // The first link made the event; the other two matched it by URL.
    expect(h.record('devfolio', 'hackiitx-2026').matchMethod).toBe('URL');
    expect(h.record('hackiitx-site', 'home').matchMethod).toBe('URL');
  });

  it('resolves title and dates to the highest trust_rank source', () => {
    const [ctftime] = h.ingestScenario(loadScenario('same-event-on-three-sources'));
    const event = h.eventOf(ctftime!);
    expect(event.title).toBe('HackIITX 2026');
    expect(event.startsAt).toBe(Date.parse('2026-11-14T04:30:00Z'));
    expect(event.endsAt).toBe(Date.parse('2026-11-15T04:30:00Z'));
    expect(event.mode).toBe('OFFLINE');
    expect(event.teamMax).toBe(4);
  });

  it('lists every differing field with all its claims and their sources', () => {
    const [ctftime] = h.ingestScenario(loadScenario('same-event-on-three-sources'));
    const event = h.eventOf(ctftime!);
    const conflicts = h.module.review.conflicts(adminContext(), event.id);
    expect(conflicts.hasConflicts).toBe(true);
    const byField = new Map(conflicts.conflicts.map((conflict) => [conflict.field, conflict]));
    for (const field of ['title', 'startsAt', 'mode'] as const) {
      const conflict = byField.get(field);
      expect(conflict, field).toBeDefined();
      expect(conflict!.values.map((value) => value.sourceKey).sort(), field).toEqual([
        'ctftime',
        'devfolio',
        'hackiitx-site',
      ]);
    }
    expect(byField.get('startsAt')?.material).toBe(true);
    expect(byField.get('mode')?.material).toBe(true);
    expect(byField.get('title')?.material).toBe(false);
    expect(
      byField
        .get('teamMax')
        ?.values.map((value) => value.sourceKey)
        .sort(),
    ).toEqual(['devfolio', 'hackiitx-site']);
    expect(byField.get('startsAt')?.selected).toBe(Date.parse('2026-11-14T04:30:00Z'));
  });
});

describe('yearly editions never merge', () => {
  it('keeps two events and writes no dedup_candidates row, despite one official URL (R64)', () => {
    const [previous, current] = h.ingestScenario(loadScenario('yearly-editions-never-merge'));
    expect(h.eventOf(previous!).id).not.toBe(h.eventOf(current!).id);
    expect(h.module.events.allEvents()).toHaveLength(2);
    expect(h.module.candidates.count('PENDING')).toBe(0);
    expect(h.module.candidates.involving(h.eventOf(current!).id)).toEqual([]);
    expect(h.record('devfolio', 'hackx-2026').matchMethod).toBe('NEW');
  });
});

describe('internal round vs national round', () => {
  function setUp(): { internal: string; national: string; candidateId: string; version: number } {
    const [internal, national] = h.ingestScenario(loadScenario('internal-round-vs-national-round'));
    const pending = h.module.candidates.list('PENDING', 10, 0);
    expect(pending).toHaveLength(1);
    return {
      internal: h.eventOf(internal!).id,
      national: h.eventOf(national!).id,
      candidateId: pending[0]!.id,
      version: pending[0]!.version,
    };
  }

  it('stays two events with a PENDING candidate, never auto-merged', () => {
    const { internal, national } = setUp();
    expect(internal).not.toBe(national);
    const [row] = h.module.candidates.list('PENDING', 10, 0);
    expect(row!.score).toBeGreaterThanOrEqual(0.7);
    expect(row!.score).toBeLessThan(0.9);
    const features = JSON.parse(row!.featuresJson) as Record<string, unknown>;
    expect(features).toMatchObject({ urlMatch: false, locationMode: 0 });
  });

  it('merge joins them', () => {
    const { internal, national, candidateId, version } = setUp();
    const result = h.module.review.merge(adminContext(), candidateId, version);
    expect(result.survivorId).toBe(internal);
    expect(result.mergedId).toBe(national);
    expect(result.candidate.status).toBe('MERGED');
    expect(h.module.provenance.recordsOf(internal)).toHaveLength(2);
    expect(h.module.events.getById(national)).toMatchObject({
      visibility: 'MERGED',
      mergedIntoEventId: internal,
    });
  });

  it('reject leaves them apart with the row REJECTED', () => {
    const { internal, national, candidateId, version } = setUp();
    const rejected = h.module.review.reject(adminContext(), candidateId, version);
    expect(rejected.status).toBe('REJECTED');
    expect(h.module.events.getById(internal)?.visibility).toBe('VISIBLE');
    expect(h.module.events.getById(national)?.visibility).toBe('VISIBLE');
    expect(h.module.provenance.recordsOf(national)).toHaveLength(1);
  });
});

describe('ctftime prize conflict', () => {
  const fixture = JSON.parse(
    readFileSync(path.join(fixturesDir(), 'dedup', 'ctftime-prize-conflict.json'), 'utf8'),
  ) as {
    eventId: number;
    expect: { selectedPrizeTextStartsWith: string; alternateContains: string };
  };

  it('keeps "$500" selected, "₹50,000" as a claim with its source, and converts nothing', async () => {
    const run = openCtftimeRun(CTFTIME_CAPTURE_CLOCK);
    const geo = openTestGeo();
    try {
      const events = createEventsModule({
        db: run.database.db,
        geocoder: geo.geocoder,
        settings: new SettingsStore(run.database.db),
        audit: new AuditLog(run.database.db),
        logger: silentLogger,
      });
      const row = await runScrape(
        { ...run.deps(recordedTransport(CTFTIME_CAPTURE_CLOCK)), linker: events.linker },
        { source: run.source, adapter: run.adapter, trigger: 'MANUAL' },
      );
      expect(row.outcome).toBe('SUCCESS');
      expect(events.events.allEvents()).toHaveLength(5);

      const record = run
        .deps(recordedTransport(CTFTIME_CAPTURE_CLOCK))
        .records.find(run.source.id, String(fixture.eventId))!;
      const event = events.events.getById(record.eventId!)!;
      expect(event.hasConflicts).toBe(true);
      expect(event.prizeText?.startsWith(fixture.expect.selectedPrizeTextStartsWith)).toBe(true);
      // No arithmetic and no conversion anywhere in the resolved row.
      expect(event.prizeTotalMinor).toBeNull();
      expect(event.prizeCurrency).toBeNull();

      const conflicts = events.review.conflicts(adminContext(), event.id);
      const prize = conflicts.conflicts.find((conflict) => conflict.field === 'prizeText');
      expect(prize?.material).toBe(true);
      expect(prize?.selectedFrom).toBe('CLAIM');
      expect(prize?.selected as string).toMatch(/^1st Place - \$500/);
      expect(prize?.values).toHaveLength(2);
      const alternate = prize?.values.find((value) => value.alternate);
      expect(alternate).toMatchObject({ sourceKey: 'ctftime', sourceRecordId: record.id });
      expect(alternate?.value as string).toContain(fixture.expect.alternateContains);
      expect(alternate?.note).toContain('nothing was converted');

      const stored = run.database.db.drizzle.select().from(eventFieldClaims).all();
      expect(stored.filter((claim) => claim.isAlternate && claim.isSelected)).toEqual([]);
    } finally {
      geo.close();
      run.close();
    }
  });
});
