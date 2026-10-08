import type { TransferPreview } from '@compintel/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { teamWith } from '../../testing/competitions.js';
import type { TestServer } from '../../testing/harness.js';
import {
  call,
  openStudentsHarness,
  startStudentsServer,
  type StudentsHarness,
} from '../../testing/students.js';

/**
 * Ownership transfer's guards (WP-21, R105): two previews and one winner, an
 * edit between preview and commit, admin only, nothing to move, and who may
 * receive it.
 */

let h: StudentsHarness;
let server: TestServer;
let dora: StudentsHarness['alice'];
let erin: StudentsHarness['alice'];
beforeAll(async () => {
  h = openStudentsHarness();
  dora = h.user('Dora Professor', ['PROFESSOR']);
  erin = h.user('Erin Professor', ['PROFESSOR']);
  server = await startStudentsServer(h, [dora, erin]);
});
afterAll(async () => {
  await server.close();
  h.close();
});

const preview = (from: string, to: string, as = h.admin) =>
  call(server, 'POST', '/api/v1/admin/ownership-transfer/preview', {
    as,
    body: { fromUserId: from, toUserId: to },
  });
const commit = (from: string, to: string, token: string, as = h.admin) =>
  call(server, 'POST', '/api/v1/admin/ownership-transfer/commit', {
    as,
    body: { fromUserId: from, toUserId: to, previewToken: token },
  });
const auditCount = (): number =>
  (h.database.db.raw.prepare('SELECT count(*) AS n FROM audit_log').get() as { n: number }).n;

describe('concurrency (R105)', () => {
  it('two previews: the first commit wins, the second is refused and writes nothing', async () => {
    await teamWith(server, h, dora, 'Dora Team A');
    const first = (await preview(dora.id, erin.id)).body as unknown as TransferPreview;
    const second = (await preview(dora.id, erin.id)).body as unknown as TransferPreview;
    expect((await commit(dora.id, erin.id, first.previewToken)).status).toBe(200);
    const audit = auditCount();
    const late = await commit(dora.id, erin.id, second.previewToken);
    expect(late.status).toBe(409);
    expect(late.body).toMatchObject({
      code: 'TRANSFER_PREVIEW_STALE',
      detail: 'Something changed since the preview — review it again.',
    });
    expect(auditCount()).toBe(audit);
  });

  it('a team edited between preview and commit is a 409', async () => {
    const team = await teamWith(server, h, erin, 'Erin Team B');
    const plan = (await preview(erin.id, dora.id)).body as unknown as TransferPreview;
    const renamed = await call(server, 'PATCH', `/api/v1/teams/${team.id}`, {
      as: erin,
      body: { name: 'Erin Team B2', version: team.version },
    });
    expect(renamed.status).toBe(200);
    expect((await commit(erin.id, dora.id, plan.previewToken)).body.code).toBe(
      'TRANSFER_PREVIEW_STALE',
    );
  });
});

describe('who and what (R105)', () => {
  it('a professor calling either route gets 403', async () => {
    expect((await preview(h.alice.id, h.bob.id, h.alice)).status).toBe(403);
    expect((await commit(h.alice.id, h.bob.id, 'a'.repeat(64), h.alice)).status).toBe(403);
  });

  it('nothing to move: an empty preview, and the commit is refused', async () => {
    const quiet = (await preview(h.bob.id, h.alice.id)).body as unknown as TransferPreview;
    expect([quiet.teams, quiet.competitions, quiet.mentorships, quiet.staysWith]).toEqual([
      [],
      [],
      [],
      [],
    ]);
    const refused = await commit(h.bob.id, h.alice.id, quiet.previewToken);
    expect(refused.status).toBe(422);
    expect(refused.body.code).toBe('TRANSFER_NOTHING_TO_MOVE');
  });

  it('to must be an active professor and differ from from; from may be disabled', async () => {
    expect((await preview(h.alice.id, h.alice.id)).body.code).toBe('TRANSFER_SAME_USER');
    expect((await preview(h.alice.id, h.admin.id)).body.code).toBe('TRANSFER_TARGET_NOT_PROFESSOR');
    h.database.db.raw.prepare("UPDATE users SET status = 'DISABLED' WHERE id = ?").run(dora.id);
    expect((await preview(h.alice.id, dora.id)).body.code).toBe('TRANSFER_TARGET_NOT_PROFESSOR');
    expect((await preview(dora.id, h.alice.id)).status).toBe(200);
    expect((await preview(dora.id, '01960000-0000-7000-8000-00000000ffff')).body.code).toBe(
      'TRANSFER_USER_NOT_FOUND',
    );
  });
});
