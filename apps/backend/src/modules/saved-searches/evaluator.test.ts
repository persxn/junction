import { afterEach, describe, expect, it } from 'vitest';

import { openSavedSearchBench, type SavedSearchBench } from '../../testing/saved-searches.js';
import { SAVED_SEARCH_EVALUATOR_JOB_KEY } from './evaluator.js';

/**
 * R112 over a real database, an injected clock and hand-ticked jobs (WP-24):
 * a new search is silent, a scrape's new matches make exactly one NEW_MATCH,
 * replays and returning events say nothing, a changed query re-baselines,
 * and the set advances with alerts or the type turned off.
 */

let bench: SavedSearchBench | undefined;
afterEach(async () => {
  await bench?.close();
  bench = undefined;
});

const HOUR = 3_600_000;
const open = (): SavedSearchBench => (bench = openSavedSearchBench());
const ai = (b: SavedSearchBench, n: number): string =>
  b.h.add({ title: `AI Hackathon ${String(n)}`, eventType: 'HACKATHON' });
const later = (b: SavedSearchBench): void => {
  b.h.clock.set(new Date(b.h.clock.now().getTime() + HOUR).toISOString());
};

describe('a saved search starts from a baseline (R112)', () => {
  it('creating a search notifies nobody, whatever it matches', () => {
    const b = open();
    for (let n = 1; n <= 5; n += 1) ai(b, n);
    const search = b.create('AI hackathons near campus', { text: 'ai' });
    expect(search.lastEvaluatedAt).not.toBeNull();
    expect(b.saved.repo.matchSet(search.id).size).toBe(5);
    b.evaluate();
    expect(b.newMatches()).toHaveLength(0);
  });

  it('a scrape adding 3 matching events → one NEW_MATCH naming 3; replayed → nothing', () => {
    const b = open();
    ai(b, 1);
    const search = b.create('AI hackathons near campus', { text: 'ai' });
    b.h.add({ title: 'Robotics Summit', eventType: 'OTHER' });
    for (let n = 2; n <= 4; n += 1) ai(b, n);
    later(b);
    b.evaluate();
    const rows = b.newMatches();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe('3 new events match “AI hackathons near campus”');
    expect(rows[0]?.body).toBe('AI Hackathon 2 · AI Hackathon 3 · AI Hackathon 4');
    expect(rows[0]?.route).toBe(`/discover/saved/${search.id}`);
    later(b);
    b.evaluate();
    expect(b.newMatches()).toHaveLength(1);
  });

  it('an event that leaves and comes back is not new', () => {
    const b = open();
    const id = ai(b, 1);
    b.create('AI', { text: 'ai' });
    b.h.database.db.raw
      .prepare("UPDATE events SET visibility = 'ADMIN_HIDDEN' WHERE id = ?")
      .run(id);
    later(b);
    b.evaluate();
    b.h.database.db.raw.prepare("UPDATE events SET visibility = 'VISIBLE' WHERE id = ?").run(id);
    later(b);
    b.evaluate();
    expect(b.newMatches()).toHaveLength(0);
  });

  it('an edited query re-baselines silently', () => {
    const b = open();
    ai(b, 1);
    b.h.add({ title: 'Blockchain Summit 1', eventType: 'OTHER' });
    const search = b.create('Mine', { text: 'ai' });
    const edited = b.saved.service.patch(b.alice, search.id, {
      version: search.version,
      query: { text: 'blockchain', limit: 25 },
    });
    expect(edited.version).toBe(search.version + 1);
    later(b);
    b.evaluate();
    expect(b.newMatches()).toHaveLength(0);
    b.h.add({ title: 'Blockchain Summit 2', eventType: 'OTHER' });
    later(b);
    b.evaluate();
    expect(b.newMatches().map((row) => row.title)).toStrictEqual(['1 new event matches “Mine”']);
  });

  it('with notify_on_new off the set still advances and no row is written', () => {
    const b = open();
    const search = b.create('Quiet', { text: 'ai' }, false);
    ai(b, 1);
    later(b);
    b.evaluate();
    expect(b.newMatches()).toHaveLength(0);
    expect(b.saved.repo.matchSet(search.id).size).toBe(1);
    // Turning alerts back on does not replay what was recorded meanwhile.
    const current = b.saved.service.list(b.alice).items[0];
    b.saved.service.patch(b.alice, search.id, {
      version: current?.version ?? 0,
      notifyOnNew: true,
    });
    later(b);
    b.evaluate();
    expect(b.newMatches()).toHaveLength(0);
  });

  it('with NEW_MATCH turned off in preferences, no row — and the set still advances', () => {
    const b = open();
    const search = b.create('Prefs', { text: 'ai' });
    b.notifications.inbox.savePreferences(b.alice.id, {
      preferences: [{ type: 'NEW_MATCH', isEnabled: false, toastEnabled: false }],
    });
    b.notifications.engine.forget(b.alice.id);
    ai(b, 1);
    later(b);
    b.evaluate();
    expect(b.newMatches()).toHaveLength(0);
    expect(b.saved.repo.matchSet(search.id).size).toBe(1);
  });

  it('skips a stored query that no longer parses, and says so on read', () => {
    const b = open();
    const search = b.create('Old', { text: 'ai' });
    b.h.database.db.raw
      .prepare(`UPDATE saved_searches SET query_json = '{"nearMe":true}' WHERE id = ?`)
      .run(search.id);
    expect(b.evaluate().skipped).toBe(1);
    const read = b.saved.service.list(b.alice).items[0];
    expect(read?.invalidQuery).toBe(true);
    expect(read?.query).toBeNull();
  });
});

describe('the trigger (R86, R22)', () => {
  const runs = (b: SavedSearchBench): number =>
    (
      b.h.database.db.raw
        .prepare('SELECT count(*) AS n FROM job_state WHERE job_key = ? AND last_run_at IS NOT NULL')
        .get(SAVED_SEARCH_EVALUATOR_JOB_KEY) as { n: number }
    ).n;

  const counting = (b: SavedSearchBench): { evaluations: number } => {
    const counter = { evaluations: 0 };
    const original = b.saved.repo.evaluable.bind(b.saved.repo);
    b.saved.repo.evaluable = () => {
      counter.evaluations += 1;
      return original();
    };
    b.saved.schedule(b.scheduler, b.hub);
    return counter;
  };

  it('a SUCCESS run triggers one evaluation; FAILED and SKIPPED_OFFLINE do not', async () => {
    const b = open();
    const counter = counting(b);
    b.runFinished('FAILED');
    b.runFinished('SKIPPED_OFFLINE');
    await b.scheduler.drain();
    expect(counter.evaluations).toBe(0);
    b.runFinished('SUCCESS');
    await b.scheduler.drain();
    expect(counter.evaluations).toBe(1);
    expect(runs(b)).toBe(1);
    b.runFinished('PARTIAL');
    await b.scheduler.drain();
    expect(counter.evaluations).toBe(2);
  });

  it('five runs finishing together → one evaluation', async () => {
    const b = open();
    const counter = counting(b);
    for (let n = 0; n < 5; n += 1) b.runFinished('SUCCESS');
    await b.scheduler.drain();
    await b.scheduler.drain();
    expect(counter.evaluations).toBe(1);
  });

  it('runs hourly as a GENERAL job that is not network-gated', async () => {
    const b = open();
    const counter = counting(b);
    await b.scheduler.tick();
    await b.scheduler.drain();
    expect(counter.evaluations).toBe(1);
    later(b);
    await b.scheduler.tick();
    await b.scheduler.drain();
    expect(counter.evaluations).toBe(2);
    const row = b.h.database.db.raw
      .prepare('SELECT kind FROM job_state WHERE job_key = ?')
      .get(SAVED_SEARCH_EVALUATOR_JOB_KEY) as { kind: string } | undefined;
    expect(row?.kind).toBe('GENERAL');
  });
});
