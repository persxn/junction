import type { SearchAlias, SearchAliasInput } from '@compintel/contracts';
import { asc, eq } from 'drizzle-orm';

import { searchAliases } from '../../db/schema/index.js';
import { withAudit, type AuditLog } from '../../platform/audit.js';
import type { DatabaseHandle } from '../../platform/db.js';
import { notFound, validationFailed } from '../../platform/errors.js';
import { nowMs, systemClock, type Clock } from '../../platform/time.js';
import { assertCan } from '../auth/policy.js';
import type { Principal } from '../auth/types.js';
import { buildAliasIndex, type AliasIndex } from './domain/text.js';
import { aliasExists } from './errors.js';

/**
 * Admin-editable search synonyms (§6.2 `search_aliases`, §10.2 "categories &
 * rules" — administrators only, every write audited).
 *
 * Expansion itself is pure (`domain/text.ts`); this is the table and the cache
 * in front of it. The cache is dropped on every write, and only this process
 * writes the table, so a stale read is not possible.
 */

export interface AliasContext {
  readonly actor: Principal;
  readonly requestId?: string | undefined;
}

export interface AliasServiceDependencies {
  readonly db: DatabaseHandle;
  readonly audit: AuditLog;
  readonly clock?: Clock;
  /** Aliases are vocabulary too; the vocabulary is refreshed after a change. */
  readonly onChange?: () => void;
}

/** Case-folded, single-spaced — so "ML" and " ml " are one term. */
export function normalizeAliasTerm(term: string): string {
  return term.trim().toLowerCase().replace(/\s+/g, ' ');
}

function parseExpansions(json: string): string[] {
  const value = JSON.parse(json) as unknown;
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

export class AliasService {
  readonly #deps: AliasServiceDependencies;
  readonly #clock: Clock;
  #index: AliasIndex | undefined;

  constructor(deps: AliasServiceDependencies) {
    this.#deps = deps;
    this.#clock = deps.clock ?? systemClock;
  }

  /** Every alias, sorted by term — what query expansion reads. */
  list(): SearchAlias[] {
    return this.#deps.db.drizzle
      .select()
      .from(searchAliases)
      .orderBy(asc(searchAliases.term))
      .all()
      .map((row) => ({ term: row.term, expansions: parseExpansions(row.expansionsJson) }));
  }

  /** The admin listing: the same rows, behind §10.2's administrator check. */
  listFor(context: AliasContext): SearchAlias[] {
    assertCan(context.actor, 'category.manage');
    return this.list();
  }

  /** The folded groups query expansion uses; cached until the next write. */
  index(): AliasIndex {
    this.#index ??= buildAliasIndex(this.list());
    return this.#index;
  }

  put(context: AliasContext, rawTerm: string, input: SearchAliasInput): SearchAlias {
    assertCan(context.actor, 'category.manage');
    const term = normalizeAliasTerm(rawTerm);
    if (term.length === 0 || term.length > 60) {
      throw validationFailed([
        { path: 'params.term', message: 'An alias term is 1–60 characters.' },
      ]);
    }
    const expansions = [...new Set(input.expansions.filter((expansion) => expansion !== term))];
    const existing = this.#deps.db.drizzle
      .select()
      .from(searchAliases)
      .where(eq(searchAliases.term, term))
      .get();
    if (existing !== undefined && input.replace !== true) {
      throw aliasExists(term);
    }
    const at = nowMs(this.#clock);
    const row = {
      term,
      expansionsJson: JSON.stringify(expansions),
      updatedAt: at,
      updatedBy: context.actor.id,
    };
    withAudit(
      this.#deps.audit,
      {
        actorKind: 'USER',
        actorUserId: context.actor.id,
        action: existing === undefined ? 'search.alias.created' : 'search.alias.replaced',
        entityKind: 'search_alias',
        entityId: term,
        summary: `${existing === undefined ? 'Added' : 'Replaced'} the search alias "${term}"`,
        diff: {
          expansions,
          ...(existing === undefined ? {} : { previous: parseExpansions(existing.expansionsJson) }),
        },
        requestId: context.requestId ?? null,
      },
      () => {
        this.#deps.db.drizzle
          .insert(searchAliases)
          .values(row)
          .onConflictDoUpdate({ target: searchAliases.term, set: row })
          .run();
      },
    );
    this.#changed();
    return { term, expansions };
  }

  delete(context: AliasContext, rawTerm: string): void {
    assertCan(context.actor, 'category.manage');
    const term = normalizeAliasTerm(rawTerm);
    const existing = this.#deps.db.drizzle
      .select()
      .from(searchAliases)
      .where(eq(searchAliases.term, term))
      .get();
    if (existing === undefined) {
      throw notFound(`There is no search alias "${term}".`);
    }
    withAudit(
      this.#deps.audit,
      {
        actorKind: 'USER',
        actorUserId: context.actor.id,
        action: 'search.alias.deleted',
        entityKind: 'search_alias',
        entityId: term,
        summary: `Removed the search alias "${term}"`,
        diff: { previous: parseExpansions(existing.expansionsJson) },
        requestId: context.requestId ?? null,
      },
      () => {
        this.#deps.db.drizzle.delete(searchAliases).where(eq(searchAliases.term, term)).run();
      },
    );
    this.#changed();
  }

  #changed(): void {
    this.#index = undefined;
    this.#deps.onChange?.();
  }
}
