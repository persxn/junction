import type { EventCategoriesInput, EventCategoriesResult } from '@compintel/contracts';

import { withAudit, type AuditLog } from '../../platform/audit.js';
import { AppError } from '../../platform/errors.js';
import { nowMs, systemClock, type Clock } from '../../platform/time.js';
import { assertCan } from '../auth/policy.js';
import type { CategoriesRepository } from '../categories/repo.js';
import type { EventDetailRepository } from './detail-repo.js';
import { eventNotFound, eventVersionConflict } from './errors.js';
import type { EventsRepository } from './repository.js';
import type { EventDetailContext } from './detail.js';

/**
 * `PUT /events/:id/categories` — a professor's override (D-15, §10.2 "Override
 * an event's categories — ✓ audited").
 *
 * **Manual beats rules, in both directions.** Adding a category writes a MANUAL
 * row; removing one writes a MANUAL row with `is_suppressed = 1`, which is what
 * survives WP-15b's re-classification (`replaceAutomatic` never touches a
 * MANUAL row). Adding back a category that was suppressed clears the
 * suppression rather than leaving two truths on one row.
 *
 * The body is the whole intended set and carries the event's `version`, so two
 * professors editing the same event at once get a 409 rather than one of them
 * silently winning.
 */

export interface EventCategoriesDependencies {
  readonly events: EventsRepository;
  readonly categories: CategoriesRepository;
  readonly detail: EventDetailRepository;
  readonly audit: AuditLog;
  readonly clock?: Clock;
}

const unknownCategory = (id: string): AppError =>
  new AppError({
    code: 'VALIDATION_FAILED',
    status: 400,
    title: 'That category no longer exists',
    detail: `No active category has the id ${id}.`,
    hint: 'Reload the event and choose from the categories offered.',
    retryable: false,
  });

export class EventCategoriesService {
  readonly #deps: EventCategoriesDependencies;
  readonly #clock: Clock;

  constructor(deps: EventCategoriesDependencies) {
    this.#deps = deps;
    this.#clock = deps.clock ?? systemClock;
  }

  set(
    context: EventDetailContext,
    eventId: string,
    input: EventCategoriesInput,
  ): EventCategoriesResult {
    assertCan(context.actor, 'event.categorize');
    const event = this.#deps.events.getVisibleEventById(eventId);
    if (event === undefined) {
      throw eventNotFound(eventId);
    }
    if (event.version !== input.version) {
      throw eventVersionConflict('This event', input.version, event.version);
    }
    const wanted = new Set(input.categoryIds);
    for (const id of wanted) {
      if (this.#deps.categories.get(id)?.isActive !== true) {
        throw unknownCategory(id);
      }
    }

    const current = this.#deps.detail.categoriesOf(eventId);
    const carried = new Set(
      current.filter((row) => !row.isSuppressed).map((category) => category.id),
    );
    const added = [...wanted].filter((id) => !carried.has(id));
    const removed = current
      .filter((row) => !row.isSuppressed && !wanted.has(row.id))
      .map((row) => row.id);
    const at = nowMs(this.#clock);

    if (added.length === 0 && removed.length === 0) {
      return { categories: current, version: event.version };
    }

    const version = withAudit(
      this.#deps.audit,
      {
        actorKind: 'USER',
        actorUserId: context.actor.id,
        action: 'event.categorized',
        entityKind: 'event',
        entityId: eventId,
        summary: `Changed the categories of “${event.title}”`,
        diff: { added, removed },
        requestId: context.requestId ?? null,
      },
      (): number => {
        for (const id of added) {
          this.#deps.categories.setManual(eventId, id, false, context.actor.id, at);
        }
        for (const id of removed) {
          this.#deps.categories.setManual(eventId, id, true, context.actor.id, at);
        }
        const next = event.version + 1;
        this.#deps.events.update(eventId, { version: next, updatedAt: at, lastChangedAt: at });
        return next;
      },
    );

    return { categories: this.#deps.detail.categoriesOf(eventId), version };
  }
}
