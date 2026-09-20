import { createHash } from 'node:crypto';

import type { AuditActorKind, Uuid7 } from '@compintel/contracts';
import { asc, desc } from 'drizzle-orm';

import { auditLog, AUDIT_GENESIS_HASH, type AuditLogRow } from '../db/schema/index.js';
import type { DatabaseHandle } from './db.js';
import { uuid7 } from './ids.js';
import { nowMs, systemClock, type Clock } from './time.js';

/**
 * The append-only audit log (§6.2, ruling R35).
 *
 * Every row hashes itself together with the hash of the row before it, so the
 * log is a chain: change one row's contents and every hash after it stops
 * matching. That is tamper *evidence*, not tamper *prevention* — prevention is
 * the two SQLite triggers in migration 0003 — and the two answer different
 * threats, so both are needed.
 *
 * The canonical form matters more than it looks. The hash is computed over JSON
 * with its keys sorted and no whitespace, so the same row hashes the same way
 * regardless of who serialized it, in which key order, in which build.
 */

/** The fields that go into the hash, in the order R35 lists them. */
export interface AuditEntry {
  readonly actorKind: AuditActorKind;
  /** The signed-in user, or null for SYSTEM/SCHEDULER/AI and failed logins. */
  readonly actorUserId?: string | null;
  /** Dotted, e.g. `auth.login.succeeded`. */
  readonly action: string;
  readonly entityKind: string;
  readonly entityId: string;
  readonly summary: string;
  /**
   * Changed fields only, PII-minimised at the call site. Never a password,
   * never a token, never a whole record: an admin can export this table.
   */
  readonly diff?: Readonly<Record<string, unknown>>;
  readonly requestId?: string | null;
}

/** JSON with sorted keys and no whitespace — the canonical form R35 fixes. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`;
}

/** What one row hashes: its own fields plus the hash of the row before it. */
export interface HashableRow {
  readonly id: string;
  readonly occurredAt: number;
  readonly actorKind: string;
  readonly actorUserId: string | null;
  readonly action: string;
  readonly entityKind: string;
  readonly entityId: string;
  readonly summary: string;
  readonly diffJson: string;
  readonly requestId: string | null;
  readonly prevHash: string;
}

export function hashRow(row: HashableRow): string {
  return createHash('sha256')
    .update(
      canonicalJson({
        id: row.id,
        occurredAt: row.occurredAt,
        actorKind: row.actorKind,
        actorUserId: row.actorUserId,
        action: row.action,
        entityKind: row.entityKind,
        entityId: row.entityId,
        summary: row.summary,
        diffJson: row.diffJson,
        requestId: row.requestId,
        prevHash: row.prevHash,
      }),
      'utf8',
    )
    .digest('hex');
}

export interface AuditLogOptions {
  readonly clock?: Clock;
  readonly newId?: () => Uuid7;
}

export interface ChainVerification {
  readonly ok: boolean;
  /** How many rows were checked. */
  readonly checked: number;
  /** The id of the first row that did not verify, if any. */
  readonly brokenAt?: string;
  readonly reason?: string;
}

/**
 * Writes audit rows and can prove the chain.
 *
 * Appends are serialized by the database transaction: the previous hash is read
 * and the new row written inside one `IMMEDIATE` transaction, so two concurrent
 * writers cannot both chain off the same predecessor. better-sqlite3 is
 * synchronous, so within one process this is also simply true.
 */
export class AuditLog {
  readonly #db: DatabaseHandle;
  readonly #clock: Clock;
  readonly #newId: () => Uuid7;

  constructor(db: DatabaseHandle, options: AuditLogOptions = {}) {
    this.#db = db;
    this.#clock = options.clock ?? systemClock;
    this.#newId = options.newId ?? uuid7;
  }

  /** Milliseconds since the epoch, the shape every timestamp column wants. */
  get #nowMs(): number {
    return nowMs(this.#clock);
  }

  /** The hash of the newest row, or the genesis hash on an empty log. */
  headHash(): string {
    const row = this.#db.drizzle
      .select({ hash: auditLog.hash })
      .from(auditLog)
      .orderBy(desc(auditLog.id))
      .limit(1)
      .get();
    return row?.hash ?? AUDIT_GENESIS_HASH;
  }

  /** Appends one row and returns it. The only way anything gets into the table. */
  append(entry: AuditEntry): AuditLogRow {
    const write = this.#db.raw.transaction((): AuditLogRow => {
      const prevHash = this.headHash();
      const row = {
        id: this.#newId(),
        occurredAt: this.#nowMs,
        actorKind: entry.actorKind,
        actorUserId: entry.actorUserId ?? null,
        action: entry.action,
        entityKind: entry.entityKind,
        entityId: entry.entityId,
        summary: entry.summary,
        diffJson: canonicalJson(entry.diff ?? {}),
        requestId: entry.requestId ?? null,
        prevHash,
      };
      const complete = { ...row, hash: hashRow(row) };
      this.#db.drizzle.insert(auditLog).values(complete).run();
      return complete;
    });
    return write.immediate();
  }

  /** Every row, oldest first. UUIDv7 keys sort in insertion order (§6.1). */
  all(): readonly AuditLogRow[] {
    return this.#db.drizzle.select().from(auditLog).orderBy(asc(auditLog.id)).all();
  }

  /**
   * Walks the chain from the genesis hash and reports the first row that does
   * not match — either because its own contents were changed, or because a row
   * before it was removed or inserted.
   */
  verifyChain(): ChainVerification {
    let expectedPrev = AUDIT_GENESIS_HASH;
    let checked = 0;
    for (const row of this.all()) {
      checked += 1;
      if (row.prevHash !== expectedPrev) {
        return {
          ok: false,
          checked,
          brokenAt: row.id,
          reason: 'the row does not chain to the one before it',
        };
      }
      if (hashRow(row) !== row.hash) {
        return { ok: false, checked, brokenAt: row.id, reason: 'the row contents were changed' };
      }
      expectedPrev = row.hash;
    }
    return { ok: true, checked };
  }
}
