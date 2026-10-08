import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { uuid7 } from '../platform/ids.js';
import { openMigratedDatabase, type MigratedDatabase } from '../testing/database.js';

/**
 * Migration 0028 (WP-21, R104): one outcome per competition; the prize amount
 * and its upper-case currency together or not at all (R63); rank ≥ 1; an
 * http/https result link; removing the certificate leaves the outcome.
 */

let database: MigratedDatabase;
let userId: string;
let departmentId: string;
const raw = () => database.db.raw;

beforeAll(() => {
  database = openMigratedDatabase(undefined, 'outcomes-schema');
  userId = uuid7();
  raw()
    .prepare(
      `INSERT INTO users (id, email, display_name, password_hash, status, created_at, updated_at)
       VALUES (?, 'o@example.edu', 'O', 'x', 'ACTIVE', 0, 0)`,
    )
    .run(userId);
  const organizationId = uuid7();
  departmentId = uuid7();
  raw()
    .prepare("INSERT INTO organizations (id, name, created_at, updated_at) VALUES (?, 'Org', 0, 0)")
    .run(organizationId);
  raw()
    .prepare(
      `INSERT INTO departments (id, organization_id, name, code, is_managing, created_at, updated_at)
       VALUES (?, ?, 'CSE', 'CSE', 1, 0, 0)`,
    )
    .run(departmentId, organizationId);
});
afterAll(() => {
  database.close();
});

function competition(): string {
  const eventId = uuid7();
  raw()
    .prepare(
      `INSERT INTO events (id, title, normalized_title, event_type, visibility, cancellation,
         last_changed_at, first_seen_at, created_at, updated_at)
       VALUES (?, 'Synthetic', 'synthetic', 'HACKATHON', 'VISIBLE', 'NONE', 0, 0, 0, 0)`,
    )
    .run(eventId);
  const id = uuid7();
  raw()
    .prepare(
      `INSERT INTO engagements (id, department_id, event_id, participant_kind, status, status_changed_at,
         created_by, created_at, updated_at)
       VALUES (?, ?, ?, 'INDIVIDUAL', 'COMPLETED', 0, ?, 0, 0)`,
    )
    .run(id, departmentId, eventId, userId);
  return id;
}

function insert(patch: Record<string, unknown> = {}): string {
  const row = {
    engagement_id: competition(),
    result: 'WINNER',
    rank: null,
    prize_minor: null,
    prize_currency: null,
    result_url: null,
    certificate_resource_id: null,
    recorded_by: userId,
    recorded_at: 1,
    ...patch,
  };
  raw()
    .prepare(
      `INSERT INTO engagement_outcomes (engagement_id, result, rank, prize_minor, prize_currency,
         result_url, certificate_resource_id, recorded_by, recorded_at)
       VALUES (@engagement_id, @result, @rank, @prize_minor, @prize_currency, @result_url,
         @certificate_resource_id, @recorded_by, @recorded_at)`,
    )
    .run(row);
  return row.engagement_id;
}

describe('engagement_outcomes (migration 0028)', () => {
  it('takes an outcome with an amount in its own currency', () => {
    const id = insert({ rank: 1, prize_minor: 5_000_000, prize_currency: 'INR' });
    expect(
      raw().prepare('SELECT version FROM engagement_outcomes WHERE engagement_id = ?').get(id),
    ).toEqual({
      version: 1,
    });
  });

  it.each([
    ['an amount without a currency', { prize_minor: 100 }],
    ['a currency without an amount', { prize_currency: 'USD' }],
    ['a lower-case currency', { prize_minor: 100, prize_currency: 'usd' }],
    ['a negative amount', { prize_minor: -1, prize_currency: 'USD' }],
    ['rank 0', { rank: 0 }],
    ['a javascript: link', { result_url: 'javascript:alert(1)' }],
    ['an unknown result', { result: 'GOLD' }],
  ])('refuses %s', (_name, patch) => {
    expect(() => insert(patch)).toThrow(/CHECK/);
  });

  it('removing the certificate resource leaves the outcome without one', () => {
    const resourceId = uuid7();
    const id = competition();
    raw()
      .prepare(
        `INSERT INTO resources (id, owner_kind, owner_id, kind, label, uri, added_by, added_at)
         VALUES (?, 'OUTCOME', ?, 'URL', 'Certificate', 'https://example.org/cert', ?, 0)`,
      )
      .run(resourceId, id, userId);
    insert({ engagement_id: id, certificate_resource_id: resourceId });
    raw().prepare('DELETE FROM resources WHERE id = ?').run(resourceId);
    expect(
      raw()
        .prepare(
          'SELECT certificate_resource_id AS cert FROM engagement_outcomes WHERE engagement_id = ?',
        )
        .get(id),
    ).toEqual({ cert: null });
  });
});
