import type { DueItem, StreamEvent } from '@compintel/contracts';

import type { NotificationEngine } from '../modules/notifications/engine.js';
import type { NotificationsRepository } from '../modules/notifications/repo.js';
import { createNotificationsModule } from '../modules/notifications/wiring.js';
import { StreamHub } from '../platform/stream.js';
import type { TestServer } from './harness.js';
import { openStudentsHarness, startStudentsServer, type StudentsHarness } from './students.js';
import { ok, withWorkflow, write } from './workflows.js';

/**
 * A notifications test bench (WP-23): the students harness with one competition
 * (Alice is its primary mentor) whose first task falls due at `taskDueIso`, an
 * engine over the same database and clock, and a run helper that moves the
 * clock to an instant and runs one evaluator pass — no real sleeps.
 */

export const DAY = 24 * 60 * 60_000;
export const HOUR = 60 * 60_000;

export interface Bench {
  readonly h: StudentsHarness;
  readonly server: TestServer;
  readonly hub: StreamHub;
  readonly repo: NotificationsRepository;
  readonly engine: NotificationEngine;
  readonly competitionId: string;
  readonly eventId: string;
  readonly taskId: string;
  now(): number;
  /** Moves the clock to `at` (never back) and runs the engine on the real items. */
  runAt(at: number, items?: (now: number) => readonly DueItem[]): void;
  /** Every notification for a subject kind, oldest first. */
  rows(subjectKind?: string): NotificationRowView[];
  /** Captures what one user's stream receives. */
  listen(userId: string): StreamEvent[];
  close(): Promise<void>;
}

export interface NotificationRowView {
  readonly id: string;
  readonly userId: string;
  readonly type: string;
  readonly severity: string;
  readonly dedupeKey: string;
  readonly readAt: number | null;
  readonly snoozedUntil: number | null;
}

const THRESHOLDS = ['OVERDUE', 'DUE_DAY', 'D14', 'D7', 'D3', 'D2', 'D1'];
export const thresholdOf = (key: string): string | undefined =>
  THRESHOLDS.find((threshold) => key.includes(`:${threshold}:`));

export async function openBench(taskDueIso: string): Promise<Bench> {
  const h = openStudentsHarness();
  const hub = new StreamHub({ clock: h.clock });
  const module = createNotificationsModule({ db: h.database.db, hub, clock: h.clock });
  const server = await startStudentsServer(h, [], { notifications: () => module, streamHub: hub });
  const { view, competitionId, eventId } = await withWorkflow(server, h, h.alice);
  const stage = view.stages[0]!;
  const taskId = stage.tasks[0]!.id;
  await ok(
    write(server, h.alice, competitionId, 'PATCH', `tasks/${taskId}`, {
      dueAt: taskDueIso,
      version: stage.version,
    }),
  );
  const repo = module.repository;
  const engine = module.engine;
  const now = (): number => h.clock.now().getTime();
  return {
    h,
    server,
    hub,
    repo,
    engine,
    competitionId,
    eventId,
    taskId,
    now,
    runAt(at, items) {
      if (at > now()) h.clock.advance(at - now());
      const t = now();
      engine.run(items === undefined ? h.deadlines.service.everything(t) : items(t), t);
    },
    rows(subjectKind) {
      return h.database.db.raw
        .prepare(
          `SELECT id, user_id AS userId, type, severity, dedupe_key AS dedupeKey, read_at AS readAt,
             snoozed_until AS snoozedUntil FROM notifications
           WHERE (@kind IS NULL OR subject_kind = @kind) ORDER BY created_at, id`,
        )
        .all({ kind: subjectKind ?? null }) as NotificationRowView[];
    },
    listen(userId) {
      const seen: StreamEvent[] = [];
      hub.subscribe({ send: (event) => seen.push(event), close: () => undefined, userId });
      return seen;
    },
    async close() {
      await server.close();
      h.close();
    },
  };
}
