import type {
  DatePrecision,
  DueItem,
  NotificationPreference,
  NotificationType,
  Severity,
} from '@compintel/contracts';

import {
  changeRecipients,
  collapseChanges,
  recipientsFor,
  type RecipientFacts,
} from '../../domain/notifications/recipients.js';
import {
  crossedThresholds,
  dedupeKey,
  pickMostUrgent,
  resurfaceable,
  severityOf,
  typeForItem,
  whenText,
  type Threshold,
} from '../../domain/notifications/rules.js';
import { uuid7, type Uuid7Generator } from '../../platform/ids.js';
import type { StreamHub } from '../../platform/stream.js';
import { nowMs, systemClock, type Clock } from '../../platform/time.js';
import {
  ADMIN_EPISODES_KEY,
  CHANGES_WATERMARK_KEY,
  type AdminState,
  type NotificationsRepository,
} from './repo.js';
import { DEADLINE_THRESHOLDS, effectivePreference } from './types.js';

/**
 * The notification engine (WP-23, R108–R111). It is a `DueItemSink` on WP-22's
 * `deadline-evaluator`, so one five-minute, offline-safe run does, in order:
 * deadline thresholds · watched-event changes since the watermark · admin
 * notices · snooze resurfacing. Rows are machine-made and not audited (R84).
 * `emit` is the door for WP-24 (NEW_MATCH) and WP-28 (BACKUP_FAILED).
 */

export interface EmitInput {
  readonly type: NotificationType;
  readonly recipients: readonly string[];
  readonly subject?: { readonly kind: string; readonly id: string } | null;
  readonly severity?: Severity;
  readonly title: string;
  readonly body: string;
  /** An in-app route only. */
  readonly route: string | null;
  readonly dedupeKey: string;
  readonly dueAt?: number | null;
  readonly precision?: DatePrecision | null;
}

const ADMIN_TYPES: readonly {
  readonly type: NotificationType;
  readonly holds: (state: AdminState) => boolean;
  readonly title: (name: string) => string;
}[] = [
  {
    type: 'SOURCE_BLOCKED',
    holds: (s) => s.blocked,
    title: (n) => `${n} was blocked after repeated refusals`,
  },
  {
    type: 'CREDENTIAL_EXPIRED',
    holds: (s) => s.credentialFailed,
    title: (n) => `${n} needs a new sign-in or key`,
  },
  {
    type: 'SCRAPER_FAILING',
    holds: (s) => s.failing,
    title: (n) => `${n} has failed three times in a row`,
  },
];

export class NotificationEngine {
  readonly #repo: NotificationsRepository;
  readonly #hub: StreamHub;
  readonly #clock: Clock;
  readonly #ids: Uuid7Generator;
  #prefs = new Map<string, Map<NotificationType, NotificationPreference>>();

  constructor(deps: {
    repo: NotificationsRepository;
    hub: StreamHub;
    clock?: Clock;
    ids?: Uuid7Generator;
  }) {
    this.#repo = deps.repo;
    this.#hub = deps.hub;
    this.#clock = deps.clock ?? systemClock;
    this.#ids = deps.ids ?? uuid7;
  }

  /** The `DueItemSink` body: one evaluator run. */
  run(items: readonly DueItem[], now: number): { created: number; resurfaced: number } {
    this.#prefs = new Map();
    const facts = this.#facts(now);
    let created = this.#deadlines(items, facts, now);
    created += this.#changes(facts, now);
    created += this.#adminNotices(now);
    return { created, resurfaced: this.#resurface(now) };
  }

  /** Insert-or-ignore for each recipient whose preference allows it, then publish. */
  emit(input: EmitInput, now: number = nowMs(this.#clock)): string[] {
    const severity = input.severity ?? severityOf({ kind: 'TYPE', type: input.type });
    const created: string[] = [];
    for (const userId of new Set(input.recipients)) {
      if (!this.preference(userId, input.type).isEnabled) continue;
      const id = this.#ids();
      const inserted = this.#repo.insert({
        id,
        userId,
        type: input.type,
        severity,
        title: input.title,
        body: input.body,
        subjectKind: input.subject?.kind ?? null,
        subjectId: input.subject?.id ?? null,
        route: input.route,
        dedupeKey: input.dedupeKey,
        dueAt: input.dueAt ?? null,
        duePrecision: input.precision ?? null,
        createdAt: now,
      });
      if (!inserted) continue;
      created.push(id);
      this.#publish('notification.created', id, userId, now);
    }
    return created;
  }

  preference(userId: string, type: NotificationType): NotificationPreference {
    let byType = this.#prefs.get(userId);
    if (byType === undefined) {
      const stored = new Map(this.#repo.preferences(userId).map((row) => [row.type, row]));
      byType = new Map();
      for (const [key, row] of stored) byType.set(key, effectivePreference(key, row));
      this.#prefs.set(userId, byType);
    }
    return byType.get(type) ?? effectivePreference(type, undefined);
  }

  #publish(
    kind: 'notification.created' | 'notification.updated',
    id: string | null,
    userId: string,
    now: number,
  ): void {
    this.#hub.publish(kind, { id, unreadCount: this.#repo.unreadCount(userId, now) }, userId);
  }

  /** For routes: a person's own read/snooze/dismiss also moves their badge. */
  published(userId: string, id: string | null): void {
    this.#publish('notification.updated', id, userId, nowMs(this.#clock));
  }

  #facts(now: number): RecipientFacts {
    return {
      mentorsOf: (id) => this.#repo.mentorsOf(id, now),
      saversOf: (id) => this.#repo.saversOf(id),
      competitionMentorsOfEvent: (id) => this.#repo.competitionMentorsOfEvent(id, now),
    };
  }

  #deadlines(items: readonly DueItem[], facts: RecipientFacts, now: number): number {
    let created = 0;
    for (const item of items) {
      const baseType = typeForItem(item, 'D7');
      for (const userId of recipientsFor(item, facts)) {
        const base = this.preference(userId, baseType);
        if (!base.isEnabled) continue;
        const thresholds = base.thresholds ?? DEADLINE_THRESHOLDS;
        const crossed = crossedThresholds(item, {
          ...thresholds,
          overdue: thresholds.overdue && this.preference(userId, 'OVERDUE').isEnabled,
        });
        const keyOf = (threshold: Threshold): string =>
          dedupeKey({
            type: typeForItem(item, threshold),
            subjectKind: item.itemKind,
            subjectId: item.id,
            threshold,
            dueAt: item.dueAt,
          });
        const existing = this.#repo.existingKeys(userId, crossed.map(keyOf));
        const pick = pickMostUrgent(
          crossed,
          new Set(crossed.filter((t) => existing.has(keyOf(t)))),
        );
        if (pick === undefined) continue;
        created += this.emit(
          {
            type: typeForItem(item, pick),
            recipients: [userId],
            subject: { kind: item.itemKind, id: item.id },
            severity: severityOf({ kind: 'THRESHOLD', threshold: pick }),
            title: `${item.label} ${whenText(pick)}`,
            body: item.competitionName ?? item.eventTitle,
            route:
              item.engagementId === null
                ? `/discover/event/${item.eventId}`
                : `/competitions/${item.engagementId}`,
            dedupeKey: keyOf(pick),
            dueAt: Date.parse(item.dueAt),
            precision: item.precision,
          },
          now,
        ).length;
      }
    }
    return created;
  }

  #changes(facts: RecipientFacts, now: number): number {
    const watermark = this.#repo.meta(CHANGES_WATERMARK_KEY);
    if (watermark === undefined) {
      // First run: history is not news. Start from here.
      this.#repo.setMeta(CHANGES_WATERMARK_KEY, this.#repo.latestChangeId(), now);
      return 0;
    }
    const changes = this.#repo.changesAfter(watermark);
    const last = changes.at(-1);
    if (last === undefined) return 0;
    let created = 0;
    for (const change of collapseChanges(changes)) {
      const cancelled = change.kind === 'CANCELLED';
      const type: NotificationType = cancelled ? 'EVENT_CANCELLED' : 'EVENT_CHANGED';
      const title = this.#repo.eventTitle(change.eventId);
      created += this.emit(
        {
          type,
          recipients: changeRecipients(change, facts),
          subject: { kind: 'event', id: change.eventId },
          severity: cancelled
            ? severityOf({
                kind: 'CANCELLED',
                hasActiveCompetition: this.#repo.hasActiveCompetition(change.eventId),
              })
            : severityOf({ kind: 'MOVED', earlier: change.earlier }),
          title: cancelled
            ? `${title} was cancelled`
            : `${title}: a deadline moved ${change.earlier ? 'earlier' : 'later'}`,
          body: cancelled
            ? 'Check the competitions that depend on it.'
            : 'Open the event to see the new date.',
          route: `/discover/event/${change.eventId}`,
          dedupeKey: dedupeKey({
            type,
            subjectKind: 'event',
            subjectId: change.eventId,
            threshold: 'CHANGE',
            dueAt: change.changeId,
          }),
        },
        now,
      ).length;
    }
    this.#repo.setMeta(CHANGES_WATERMARK_KEY, last.id, now);
    return created;
  }

  /** Keyed on the episode's onset, so a state that clears and comes back re-arms. */
  #adminNotices(now: number): number {
    const stored = this.#repo.meta(ADMIN_EPISODES_KEY);
    const before = stored === undefined ? {} : (JSON.parse(stored) as Record<string, number>);
    const episodes: Record<string, number> = {};
    const admins = this.#repo.activeAdmins();
    let created = 0;
    for (const state of this.#repo.adminStates()) {
      for (const rule of ADMIN_TYPES) {
        if (!rule.holds(state)) continue;
        const key = `${state.sourceId}:${rule.type}`;
        const onset = before[key] ?? now;
        episodes[key] = onset;
        created += this.emit(
          {
            type: rule.type,
            recipients: admins,
            subject: { kind: 'source', id: state.sourceId },
            title: rule.title(state.sourceName),
            body: 'Open Sources to see what happened and what to do.',
            route: '/admin/sources',
            dedupeKey: dedupeKey({
              type: rule.type,
              subjectKind: 'source',
              subjectId: state.sourceId,
              threshold: 'STATE',
              dueAt: String(onset),
            }),
          },
          now,
        ).length;
      }
    }
    this.#repo.setMeta(ADMIN_EPISODES_KEY, JSON.stringify(episodes), now);
    return created;
  }

  /** R111: the same run brings snoozed rows back. */
  #resurface(now: number): number {
    const due = resurfaceable(this.#repo.snoozed(now), now);
    for (const row of due) {
      this.#repo.resurface(row.id);
      this.#publish('notification.updated', row.id, row.userId, now);
    }
    return due.length;
  }
}
