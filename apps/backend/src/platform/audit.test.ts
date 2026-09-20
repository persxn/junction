import { afterEach, describe, expect, it } from 'vitest';

import { AUDIT_GENESIS_HASH, auditLog } from '../db/schema/index.js';
import { createTestDatabase, type TestDatabase } from '../testing/database.js';
import { AuditLog, canonicalJson, hashRow } from './audit.js';

/**
 * The append-only audit log (§6.2, ruling R35). Two independent guarantees are
 * under test: the triggers (nothing in this process can rewrite history) and the
 * hash chain (nothing outside it can, undetected).
 */

let harness: TestDatabase | undefined;

afterEach(() => {
  harness?.close();
  harness = undefined;
});

function open(): { audit: AuditLog; harness: TestDatabase } {
  harness = createTestDatabase('audit');
  return { audit: new AuditLog(harness.db), harness };
}

const ENTRY = {
  actorKind: 'USER' as const,
  actorUserId: null,
  action: 'auth.login.succeeded',
  entityKind: 'session',
  entityId: 'session-1',
  summary: 'someone signed in',
};

describe('canonical JSON (ruling R35)', () => {
  it('sorts keys, whatever order they were written in', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalJson({ a: 2, b: 1 })).toBe('{"a":2,"b":1}');
  });

  it('uses no whitespace and keeps arrays in order', () => {
    expect(canonicalJson({ list: [3, 1, 2], nested: { z: 1, a: 2 } })).toBe(
      '{"list":[3,1,2],"nested":{"a":2,"z":1}}',
    );
  });

  it('drops undefined and keeps null, so the two never hash the same', () => {
    expect(canonicalJson({ a: undefined, b: null })).toBe('{"b":null}');
  });

  it('handles the primitives', () => {
    expect(canonicalJson('x')).toBe('"x"');
    expect(canonicalJson(7)).toBe('7');
    expect(canonicalJson(null)).toBe('null');
  });
});

describe('the chain', () => {
  it('starts from 64 zeros', () => {
    const { audit } = open();
    expect(audit.headHash()).toBe(AUDIT_GENESIS_HASH);
    const row = audit.append(ENTRY);
    expect(row.prevHash).toBe(AUDIT_GENESIS_HASH);
    expect(row.hash).toHaveLength(64);
  });

  it('links each row to the one before it', () => {
    const { audit } = open();
    const first = audit.append(ENTRY);
    const second = audit.append({ ...ENTRY, entityId: 'session-2' });
    expect(second.prevHash).toBe(first.hash);
    expect(audit.headHash()).toBe(second.hash);
  });

  it('verifies a chain of many rows', () => {
    const { audit } = open();
    for (let index = 0; index < 50; index += 1) {
      audit.append({ ...ENTRY, entityId: `session-${String(index)}` });
    }
    expect(audit.verifyChain()).toStrictEqual({ ok: true, checked: 50 });
  });

  it('verifies an empty log', () => {
    const { audit } = open();
    expect(audit.verifyChain().ok).toBe(true);
  });

  it('notices a row whose contents were changed', () => {
    const { audit, harness: h } = open();
    audit.append(ENTRY);
    const target = audit.append({ ...ENTRY, summary: 'the original summary' });
    audit.append({ ...ENTRY, entityId: 'session-3' });

    // Go round the triggers the way an outsider with a SQLite browser would.
    h.db.raw.exec('DROP TRIGGER audit_log_no_update');
    h.db.raw
      .prepare('UPDATE audit_log SET summary = ? WHERE id = ?')
      .run('tampered with', target.id);

    const result = audit.verifyChain();
    expect(result.ok).toBe(false);
    expect(result.brokenAt).toBe(target.id);
    expect(result.reason).toBe('the row contents were changed');
  });

  it('notices a row that was removed from the middle', () => {
    const { audit, harness: h } = open();
    audit.append(ENTRY);
    const target = audit.append({ ...ENTRY, entityId: 'session-2' });
    audit.append({ ...ENTRY, entityId: 'session-3' });

    h.db.raw.exec('DROP TRIGGER audit_log_no_delete');
    h.db.raw.prepare('DELETE FROM audit_log WHERE id = ?').run(target.id);

    const result = audit.verifyChain();
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('the row does not chain to the one before it');
  });

  it('hashes the same row the same way every time', () => {
    const row = {
      id: 'a',
      occurredAt: 1,
      actorKind: 'USER',
      actorUserId: null,
      action: 'x.y',
      entityKind: 'k',
      entityId: 'i',
      summary: 's',
      diffJson: '{}',
      requestId: null,
      prevHash: AUDIT_GENESIS_HASH,
    };
    expect(hashRow(row)).toBe(hashRow({ ...row }));
    expect(hashRow({ ...row, summary: 's ' })).not.toBe(hashRow(row));
  });
});

describe('the triggers (append-only)', () => {
  it('rejects an UPDATE', () => {
    const { audit, harness: h } = open();
    const row = audit.append(ENTRY);
    expect(() =>
      h.db.raw.prepare('UPDATE audit_log SET summary = ? WHERE id = ?').run('nope', row.id),
    ).toThrow(/append-only/);
  });

  it('rejects a DELETE', () => {
    const { audit, harness: h } = open();
    const row = audit.append(ENTRY);
    expect(() => h.db.raw.prepare('DELETE FROM audit_log WHERE id = ?').run(row.id)).toThrow(
      /append-only/,
    );
  });

  it('rejects a bulk DELETE too', () => {
    const { audit, harness: h } = open();
    audit.append(ENTRY);
    expect(() => h.db.raw.exec('DELETE FROM audit_log')).toThrow(/append-only/);
  });

  it('still allows an INSERT, which is the whole point', () => {
    const { audit } = open();
    expect(() => audit.append(ENTRY)).not.toThrow();
  });
});

describe('what a row may carry', () => {
  it('rejects an actor kind that is not in the contracts list', () => {
    const { harness: h } = open();
    expect(() =>
      h.db.raw
        .prepare(
          'INSERT INTO audit_log (id, occurred_at, actor_kind, action, entity_kind, entity_id, ' +
            'summary, diff_json, prev_hash, hash) VALUES (?,?,?,?,?,?,?,?,?,?)',
        )
        .run('x', 1, 'ROBOT', 'a.b', 'k', 'i', 's', '{}', '0'.repeat(64), '1'.repeat(64)),
    ).toThrow(/CHECK constraint/i);
  });

  it('stores the diff canonically, so it hashes stably', () => {
    const { audit } = open();
    const row = audit.append({ ...ENTRY, diff: { b: 2, a: 1 } });
    expect(row.diffJson).toBe('{"a":1,"b":2}');
  });

  it('defaults the diff to an empty object rather than null', () => {
    const { audit } = open();
    expect(audit.append(ENTRY).diffJson).toBe('{}');
  });

  it('threads the request id through', () => {
    const { audit } = open();
    expect(audit.append({ ...ENTRY, requestId: 'req-42' }).requestId).toBe('req-42');
  });

  it('reads rows back in insertion order', () => {
    const { audit } = open();
    const ids = ['a', 'b', 'c'].map((suffix) => audit.append({ ...ENTRY, entityId: suffix }).id);
    expect(new AuditLog(harness!.db).all().map((row) => row.id)).toStrictEqual(ids);
  });

  it('uses the injected clock and id generator', () => {
    harness = createTestDatabase('audit');
    let id = 0;
    const audit = new AuditLog(harness.db, {
      now: () => 1_700_000_000_000,
      newId: () => {
        id += 1;
        return `0192f0c1-0000-7000-8000-${String(id).padStart(12, '0')}`;
      },
    });
    const row = audit.append(ENTRY);
    expect(row.occurredAt).toBe(1_700_000_000_000);
    expect(row.id).toBe('0192f0c1-0000-7000-8000-000000000001');
  });

  it('refuses a hash that is not 64 characters', () => {
    const { harness: h } = open();
    expect(() =>
      h.db.drizzle
        .insert(auditLog)
        .values({
          id: 'x',
          occurredAt: 1,
          actorKind: 'SYSTEM',
          actorUserId: null,
          action: 'a.b',
          entityKind: 'k',
          entityId: 'i',
          summary: 's',
          diffJson: '{}',
          requestId: null,
          prevHash: 'short',
          hash: 'short',
        })
        .run(),
    ).toThrow(/CHECK constraint/i);
  });
});
