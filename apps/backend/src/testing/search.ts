import path from 'node:path';

import type { EventQueryInput, SearchRequestInput, SearchResponse } from '@compintel/contracts';

import {
  campuses,
  organizations,
  sourceRecords,
  users,
  type EventRow,
} from '../db/schema/index.js';
import { applyCategorySeed, loadCategorySeed } from '../modules/categories/seed.js';
import { createCategoriesModule, type CategoriesModule } from '../modules/categories/wiring.js';
import type { Principal } from '../modules/auth/types.js';
import { EventsRepository } from '../modules/events/repository.js';
import type { CursorCodec } from '../modules/search/cursor.js';
import { createSearchModule, type SearchModule } from '../modules/search/wiring.js';
import { AuditLog } from '../platform/audit.js';
import { uuid7 } from '../platform/ids.js';
import { SettingsStore, type SettingDefinition } from '../platform/settings.js';
import type { Clock } from '../platform/time.js';
import { openMigratedDatabase, type MigratedDatabase } from './database.js';
import { silentLogger } from './scraping.js';

/**
 * A WP-15a harness: a migrated database, the real search module, and a fast
 * way to put events in it. Events are inserted as rows (through
 * `EventsRepository.insert`, so the FTS triggers fire exactly as they do for a
 * scrape) rather than through the linker — search reads resolved rows, and a
 * test about the fee filter should not depend on dedup.
 */

/** The committed starter taxonomy (WP-15b). */
export const CATEGORY_SEED_FILE = path.resolve(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  'resources',
  'category-rules.seed.json',
);

/** Noon in Asia/Kolkata on 22 Sep 2026. */
export const SEARCH_NOW = '2026-09-22T06:30:00.000Z';

export type EventSpec = { readonly title: string } & Partial<Omit<EventRow, 'id' | 'title'>>;

export interface SearchHarness {
  readonly database: MigratedDatabase;
  readonly search: SearchModule;
  readonly events: EventsRepository;
  readonly audit: AuditLog;
  readonly categories: CategoriesModule;
  readonly settings: SettingsStore;
  readonly clock: Clock & { set(iso: string): void };
  /** A stored user (the per-user tables have real foreign keys). */
  user(role?: 'ADMINISTRATOR' | 'PROFESSOR'): Principal;
  /** Sets the primary campus distances are measured from. */
  campus(lat: number, lon: number): void;
  add(spec: EventSpec): string;
  /** Links an event to a seeded source, as a scrape would; `sourceTags` go in its payload. */
  addSource(eventId: string, sourceKey: string, sourceTags?: readonly string[]): void;
  /** Loads the committed starter taxonomy (WP-15b). */
  seedCategories(): void;
  /** Classifies every event, as the re-classification job would. */
  classifyAll(): Promise<void>;
  /** A tag (§6.2 `tags`), created on first use; returns its id. */
  tag(name: string): string;
  /** Tags an event (`event_tags`). */
  tagEvent(eventId: string, name: string): void;
  /** Adds an interest tag to a user (`user_interest_tags`). */
  interest(actor: Principal, name: string): void;
  setSetting<T>(definition: SettingDefinition<T>, value: T): void;
  query(query: SearchRequestInput | EventQueryInput, actor?: Principal): SearchResponse;
  /** The titles `query` returns, in order — the readable assertion. */
  titles(query: EventQueryInput, actor?: Principal): string[];
  close(): void;
}

export function openSearchHarness(options: { cursors?: CursorCodec } = {}): SearchHarness {
  const database = openMigratedDatabase(silentLogger, 'search');
  let now = Date.parse(SEARCH_NOW);
  const clock = {
    now: () => new Date(now),
    set: (iso: string) => {
      now = Date.parse(iso);
    },
  };
  const audit = new AuditLog(database.db, { clock });
  const events = new EventsRepository(database.db);
  const settings = new SettingsStore(database.db, { clock });
  const categories = createCategoriesModule({ db: database.db, audit, clock });
  const search = createSearchModule({
    db: database.db,
    audit,
    events,
    clock,
    settings,
    ...(options.cursors === undefined ? {} : { cursors: options.cursors }),
  });
  let vocabularyStale = true;

  const user = (role: 'ADMINISTRATOR' | 'PROFESSOR' = 'PROFESSOR'): Principal => {
    const id = uuid7();
    const email = `${role.toLowerCase()}-${id.slice(-8)}@example.edu`;
    database.db.drizzle
      .insert(users)
      .values({ id, email, displayName: role, passwordHash: 'x', createdAt: now, updatedAt: now })
      .run();
    return {
      id,
      email,
      displayName: role,
      departmentId: null,
      status: 'ACTIVE',
      mustChangePassword: false,
      roles: [role],
    };
  };
  const defaultActor = user('PROFESSOR');

  const tag = (name: string): string => {
    const normalized = name.trim().toLowerCase();
    const found = database.db.raw
      .prepare("SELECT id FROM tags WHERE kind = 'INTEREST' AND normalized = ?")
      .get(normalized) as { id: string } | undefined;
    if (found !== undefined) return found.id;
    const id = uuid7();
    database.db.raw
      .prepare(
        "INSERT INTO tags (id, kind, name, normalized, created_at) VALUES (?, 'INTEREST', ?, ?, ?)",
      )
      .run(id, name, normalized, now);
    return id;
  };

  const query = (
    input: SearchRequestInput | EventQueryInput,
    actor: Principal = defaultActor,
  ): SearchResponse => {
    if (vocabularyStale) {
      search.vocabulary.refresh();
      vocabularyStale = false;
    }
    return search.service.search({ actor }, input);
  };

  return {
    database,
    search,
    events,
    audit,
    categories,
    settings,
    clock,
    user,
    campus: (lat, lon) => {
      const organizationId = uuid7();
      database.db.drizzle
        .insert(organizations)
        .values({ id: organizationId, name: 'Test Institute', createdAt: now, updatedAt: now })
        .run();
      database.db.drizzle
        .insert(campuses)
        .values({
          id: uuid7(),
          organizationId,
          name: 'Main',
          lat,
          lon,
          isPrimary: true,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    },
    add: (spec) => {
      vocabularyStale = true;
      const { title, ...fields } = spec;
      return events.insert({
        title,
        normalizedTitle: title.toLowerCase(),
        eventType: spec.eventType ?? 'HACKATHON',
        isRecurringRound: spec.isRecurringRound ?? false,
        visibility: spec.visibility ?? 'VISIBLE',
        qualityScore: 50,
        firstSeenAt: spec.firstSeenAt ?? now,
        lastChangedAt: now,
        createdAt: now,
        updatedAt: now,
        fields,
      });
    },
    seedCategories: () => {
      applyCategorySeed(database.db, loadCategorySeed(CATEGORY_SEED_FILE), now);
      categories.classifier.rulesChanged();
    },
    classifyAll: async () => {
      categories.classifier.requestReclassification('test', null);
      await categories.classifier.processPending();
    },
    tag,
    tagEvent: (eventId, name) => {
      database.db.raw
        .prepare(
          "INSERT OR IGNORE INTO event_tags (event_id, tag_id, origin) VALUES (?, ?, 'MANUAL')",
        )
        .run(eventId, tag(name));
    },
    interest: (actor, name) => {
      database.db.raw
        .prepare('INSERT OR IGNORE INTO user_interest_tags (user_id, tag_id) VALUES (?, ?)')
        .run(actor.id, tag(name));
    },
    setSetting: (definition, value) => {
      settings.set(definition, value);
    },
    addSource: (eventId, sourceKey, sourceTags) => {
      const source = database.db.raw
        .prepare('SELECT id FROM sources WHERE key = ?')
        .get(sourceKey) as { id: string } | undefined;
      if (source === undefined) throw new Error(`no seeded source ${sourceKey}`);
      const external = uuid7();
      database.db.drizzle
        .insert(sourceRecords)
        .values({
          id: uuid7(),
          sourceId: source.id,
          externalKey: external,
          url: `https://${sourceKey}.example.test/${external}`,
          firstSeenAt: now,
          lastSeenAt: now,
          lastFetchedAt: now,
          contentHash: external,
          payloadJson: JSON.stringify(sourceTags === undefined ? {} : { sourceTags }),
          eventId,
          originEventId: eventId,
        })
        .run();
      // R88: what the resolver does after every link.
      events.update(eventId, { topTrustRank: events.topTrustRank(eventId) });
    },
    query,
    titles: (input, actor) => query(input, actor).items.map((item) => item.title),
    close: () => {
      database.close();
    },
  };
}
