import type { DueItem } from '@compintel/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import {
  MINUTE,
  T0,
  clock,
  schedulerHarness,
  type SchedulerHarness,
} from '../../testing/scheduler.js';
import { uuid7 } from '../../platform/ids.js';
import {
  DEADLINE_EVALUATOR_JOB_KEY,
  registerDeadlineEvaluator,
  registerDueItemSink,
} from './evaluator.js';
import { createDeadlinesModule } from './wiring.js';

/**
 * The `deadline-evaluator` job (WP-22, R22, D-23), driven by an injected clock
 * with no real sleeps: it runs with the machine offline, hands the bucketed
 * items to each registered sink, and catches up once — not many times — after
 * an eight-hour clock jump.
 */

let harness: SchedulerHarness | undefined;
let unregister: (() => void) | undefined;
afterEach(async () => {
  unregister?.();
  await harness?.close();
  harness = undefined;
});

function savedEventDueSoon(h: SchedulerHarness): void {
  const raw = h.database.db.raw;
  const user = uuid7();
  raw
    .prepare(
      `INSERT INTO users (id, email, display_name, password_hash, status, created_at, updated_at)
       VALUES (?, 'e@example.edu', 'E', 'x', 'ACTIVE', 0, 0)`,
    )
    .run(user);
  const event = uuid7();
  raw
    .prepare(
      `INSERT INTO events (id, title, normalized_title, event_type, registration_deadline_at,
         registration_deadline_precision, visibility, cancellation, last_changed_at, first_seen_at,
         created_at, updated_at)
       VALUES (?, 'Synthetic', 'synthetic', 'HACKATHON', ?, 'DATETIME', 'VISIBLE', 'NONE', 0, 0, 0, 0)`,
    )
    .run(event, T0 + 2 * 24 * 60 * MINUTE);
  raw
    .prepare('INSERT INTO watchlist_items (user_id, event_id, added_at) VALUES (?, ?, 0)')
    .run(user, event);
}

describe('deadline-evaluator', () => {
  it('runs offline, feeds every sink, and catches up once after an 8 h jump', async () => {
    const time = clock();
    const h = schedulerHarness({ clock: time, isOnline: () => false });
    harness = h;
    savedEventDueSoon(h);
    const seen: DueItem[][] = [];
    unregister = registerDueItemSink({
      name: 'test',
      consume: (items) => {
        seen.push([...items]);
      },
    });
    registerDeadlineEvaluator(
      h.scheduler,
      createDeadlinesModule({ db: h.database.db, clock: time }),
    );

    await h.scheduler.tick();
    await h.scheduler.drain();
    expect(seen).toHaveLength(1);
    expect(seen[0]?.map((item) => [item.itemKind, item.bucket])).toEqual([
      ['EVENT_DEADLINE', 'DAYS_3'],
    ]);
    expect(h.store.read(DEADLINE_EVALUATOR_JOB_KEY)?.lastOutcome).toBe('SUCCESS');

    // Not due again within five minutes.
    time.advance(MINUTE);
    await h.scheduler.tick();
    await h.scheduler.drain();
    expect(seen).toHaveLength(1);

    // The laptop slept eight hours: one catch-up run, not ninety-six.
    time.advance(8 * 60 * MINUTE);
    await h.scheduler.tick();
    await h.scheduler.drain();
    await h.scheduler.tick();
    await h.scheduler.drain();
    expect(seen).toHaveLength(2);
    expect(h.store.read(DEADLINE_EVALUATOR_JOB_KEY)?.nextDueAt).toBe(
      time.now().getTime() + 5 * MINUTE,
    );
  });
});
