import { AUDIT_ACTOR_KINDS } from '@compintel/contracts';
import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { users } from './identity.js';

/** `'A', 'B'` — CHECK lists are written from the contracts enums (§6.1). */
function quoted(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(', ');
}

/** The genesis `prev_hash`: 64 zeros, so the first row chains to nothing (R35). */
export const AUDIT_GENESIS_HASH = '0'.repeat(64);

/**
 * §6.2 `audit_log`, append-only.
 *
 * Two mechanisms, and they answer different attacks. The SQLite triggers (in the
 * custom part of migration 0002) stop anything in *this* process from editing
 * history, including a bug. The hash chain is for someone editing the file
 * directly with another tool: they can change a row, but not without breaking
 * every hash after it, which `verifyChain()` will then report.
 *
 * `diff_json` holds changed fields only and is PII-minimised at the call site —
 * the audit log is the one table an admin exports, so it must not become a
 * second copy of the student records.
 */
export const auditLog = sqliteTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    occurredAt: integer('occurred_at').notNull(),
    actorKind: text('actor_kind').notNull(),
    /** NULL for SYSTEM, SCHEDULER and AI rows, and for a failed login. */
    actorUserId: text('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Dotted, e.g. `auth.login.succeeded`, `team.member.added`. */
    action: text('action').notNull(),
    entityKind: text('entity_kind').notNull(),
    entityId: text('entity_id').notNull(),
    /** One human-readable line; what the activity timeline shows. */
    summary: text('summary').notNull(),
    /** JSON object of changed fields, or `{}`. Never a whole record. */
    diffJson: text('diff_json').notNull().default('{}'),
    /** Correlates with `X-Request-Id` and the log line for the same request. */
    requestId: text('request_id'),
    prevHash: text('prev_hash').notNull(),
    hash: text('hash').notNull(),
  },
  (table) => [
    index('audit_log_occurred_at_idx').on(table.occurredAt),
    index('audit_log_actor_user_id_idx').on(table.actorUserId),
    // "Everything that happened to this record", the §10.2 activity timeline.
    index('audit_log_entity_idx').on(table.entityKind, table.entityId),
    check('audit_log_actor_kind_check', sql.raw(`"actor_kind" in (${quoted(AUDIT_ACTOR_KINDS)})`)),
    check('audit_log_hash_check', sql.raw(`length("hash") = 64 and length("prev_hash") = 64`)),
  ],
);
export type AuditLogRow = typeof auditLog.$inferSelect;
