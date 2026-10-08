import type { CompetitionDetail, Resource, ResourceList } from '@compintel/contracts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { TestServer } from '../../testing/harness.js';
import {
  call,
  openStudentsHarness,
  startStudentsServer,
  type StudentsHarness,
} from '../../testing/students.js';
import { ok, withWorkflow, write } from '../../testing/workflows.js';

/**
 * Resources over HTTP (WP-20b, R103): kinds and refusals, every owner kind
 * resolved to its competition, the permission rows, a stale version, check
 * results as machine state, removals that take resources with them — and no
 * request leaving the process.
 */

let h: StudentsHarness;
let server: TestServer;
let carol: StudentsHarness['alice'];
const fetchSpy = vi.spyOn(globalThis, 'fetch');
beforeAll(async () => {
  h = openStudentsHarness();
  carol = h.user('Carol Professor', ['PROFESSOR']);
  server = await startStudentsServer(h, [carol]);
});
afterAll(async () => {
  // R103: a link is never fetched. Every request the test made went to its own server.
  const hosts = new Set(
    fetchSpy.mock.calls.map(
      ([url]) => new URL(url instanceof Request ? url.url : url.toString()).origin,
    ),
  );
  expect([...hosts]).toEqual([server.baseUrl]);
  fetchSpy.mockRestore();
  await server.close();
  h.close();
});

const add = (body: Record<string, unknown>, as = h.alice) =>
  call(server, 'POST', '/api/v1/resources', { as, body });
const added = async (body: Record<string, unknown>, as = h.alice): Promise<Resource> => {
  const response = await add(body, as);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body as unknown as Resource;
};
const listOf = async (competitionId: string, as = h.alice): Promise<ResourceList> =>
  (await call(server, 'GET', `/api/v1/competitions/${competitionId}/resources`, { as }))
    .body as unknown as ResourceList;
const auditRows = (competitionId: string) =>
  h.database.db.raw
    .prepare(
      "SELECT action, summary, diff_json AS diff FROM audit_log WHERE entity_id = ? AND action LIKE 'resource.%'",
    )
    .all(competitionId) as { action: string; summary: string; diff: string }[];

describe('adding (R103)', () => {
  it('detects and normalizes each kind; a label comes from the link or the file name', async () => {
    const { competitionId } = await withWorkflow(server, h, h.alice);
    const owner = { ownerKind: 'ENGAGEMENT', ownerId: competitionId };
    const github = await added({ ...owner, uri: 'https://github.com/acme/rocket.git/' });
    expect(github).toMatchObject({
      kind: 'GITHUB',
      uri: 'https://github.com/acme/rocket',
      label: 'acme/rocket',
      checkStatus: 'UNCHECKED',
      version: 1,
      addedBy: 'Alice Professor',
    });
    const doc = await added({ ...owner, uri: 'https://docs.google.com/document/d/x/edit' });
    expect(doc.kind).toBe('CLOUD_DOC');
    const path = await added({
      ...owner,
      uri: 'C:\\Team\\deck.pptx',
      machineLabel: 'LAB-PC-07',
    });
    expect(path).toMatchObject({
      kind: 'LOCAL_PATH',
      label: 'deck.pptx',
      machineLabel: 'LAB-PC-07',
    });
    const link = await added({ ...owner, uri: 'https://devfolio.co/x', machineLabel: 'LAB-PC-07' });
    expect(link).toMatchObject({ kind: 'URL', machineLabel: null });
  });

  it('refuses javascript:, file:, data: and relative paths, and a kind the text does not fit', async () => {
    const { competitionId } = await withWorkflow(server, h, h.alice);
    for (const [uri, kind] of [
      ['javascript:alert(1)', undefined],
      ['file:///C:/Windows/notepad.exe', undefined],
      ['data:text/html,<b>', undefined],
      ['report.pdf', undefined],
      ['https://devfolio.co/x', 'GITHUB'],
    ] as const) {
      const response = await add({
        ownerKind: 'ENGAGEMENT',
        ownerId: competitionId,
        uri,
        ...(kind === undefined ? {} : { kind }),
      });
      expect(response.status, uri).toBe(422);
      expect(response.body.code).toBe('RESOURCE_INVALID_URI');
    }
    expect(auditRows(competitionId)).toEqual([]);
  });

  it('resolves every owner kind to its competition, and refuses an unknown owner', async () => {
    const { competitionId, view } = await withWorkflow(server, h, h.alice);
    const stage = view.stages[1]!;
    const task = stage.tasks[0]!;
    await added({ ownerKind: 'TASK', ownerId: task.id, uri: 'https://example.org/task' });
    await added({ ownerKind: 'STAGE', ownerId: stage.id, uri: 'https://example.org/stage' });
    // The outcome's key is the competition's id.
    await added({ ownerKind: 'OUTCOME', ownerId: competitionId, uri: 'https://example.org/cert' });
    await added({ ownerKind: 'ENGAGEMENT', ownerId: competitionId, uri: 'https://example.org/c' });
    const list = await listOf(competitionId);
    expect(list.canEdit).toBe(true);
    expect(list.groups.map((group) => [group.ownerKind, group.ownerLabel])).toEqual([
      ['ENGAGEMENT', 'Competition'],
      ['OUTCOME', 'Outcome'],
      ['STAGE', stage.name],
      ['TASK', task.title],
    ]);
    const unknown = await add({
      ownerKind: 'STAGE',
      ownerId: '01960000-0000-7000-8000-00000000ffff',
      uri: 'https://example.org',
    });
    expect(unknown.status).toBe(404);
    expect(unknown.body.code).toBe('RESOURCE_OWNER_NOT_FOUND');
  });

  it('audits who added what kind where — never the link, path or label (R92)', async () => {
    const { competitionId } = await withWorkflow(server, h, h.alice);
    await added({
      ownerKind: 'ENGAGEMENT',
      ownerId: competitionId,
      uri: 'C:\\Users\\asha.demo\\cv.pdf',
      label: 'Asha’s CV',
    });
    const [row] = auditRows(competitionId);
    expect(row?.summary).toBe('Added a path on a PC to the competition');
    expect(`${row?.summary ?? ''} ${row?.diff ?? ''}`).not.toMatch(/asha|cv\.pdf|C:\\/i);
  });
});

describe('who may write (R96, §10.2)', () => {
  it('mentor, co-mentor and admin may; another professor gets 403 but can read', async () => {
    const { competitionId } = await withWorkflow(server, h, h.alice);
    const competition = (
      await call(server, 'GET', `/api/v1/competitions/${competitionId}`, { as: h.alice })
    ).body as unknown as CompetitionDetail;
    await call(server, 'POST', `/api/v1/competitions/${competitionId}/mentors`, {
      as: h.alice,
      body: { userId: h.bob.id, version: competition.version },
    });
    for (const [who, as, status] of [
      ['other professor', carol, 403],
      ['primary mentor', h.alice, 200],
      ['co-mentor', h.bob, 200],
      ['admin', h.admin, 200],
    ] as const) {
      const response = await add(
        { ownerKind: 'ENGAGEMENT', ownerId: competitionId, uri: 'https://example.org/x' },
        as,
      );
      expect(response.status, who).toBe(status);
    }
    const asCarol = await listOf(competitionId, carol);
    expect(asCarol.canEdit).toBe(false);
    expect(asCarol.groups[0]?.resources).toHaveLength(3);
  });
});

describe('editing and removing', () => {
  it('a stale version gets 409 in the house words and writes nothing', async () => {
    const { competitionId } = await withWorkflow(server, h, h.alice);
    const resource = await added({
      ownerKind: 'ENGAGEMENT',
      ownerId: competitionId,
      uri: 'https://example.org/a',
    });
    const renamed = await call(server, 'PATCH', `/api/v1/resources/${resource.id}`, {
      as: h.alice,
      body: { label: 'Brief', version: 1 },
    });
    expect(renamed.body).toMatchObject({ label: 'Brief', version: 2 });
    const stale = await call(server, 'PATCH', `/api/v1/resources/${resource.id}`, {
      as: h.alice,
      body: { label: 'Late', version: 1 },
    });
    expect(stale.status).toBe(409);
    expect(stale.body.detail).toBe('Someone else changed this — reload to see their change.');
    const gone = await call(server, 'DELETE', `/api/v1/resources/${resource.id}`, {
      as: h.alice,
      body: { version: 1 },
    });
    expect(gone.status).toBe(409);
    expect((await listOf(competitionId)).groups[0]?.resources[0]?.label).toBe('Brief');
    expect(
      (
        await call(server, 'DELETE', `/api/v1/resources/${resource.id}`, {
          as: h.alice,
          body: { version: 2 },
        })
      ).status,
    ).toBe(204);
    expect(auditRows(competitionId).map((row) => row.action)).toEqual([
      'resource.added',
      'resource.updated',
      'resource.removed',
    ]);
  });

  it('removing a stage takes its resources and its tasks’; removing a task takes its own', async () => {
    const { competitionId, view } = await withWorkflow(server, h, h.alice);
    const [first, second] = view.stages;
    await added({ ownerKind: 'STAGE', ownerId: first!.id, uri: 'https://example.org/s' });
    await added({ ownerKind: 'TASK', ownerId: first!.tasks[0]!.id, uri: 'https://example.org/t' });
    await added({ ownerKind: 'TASK', ownerId: second!.tasks[0]!.id, uri: 'https://example.org/u' });
    await ok(
      write(server, h.alice, competitionId, 'POST', `stages/${first!.id}/remove`, {
        version: view.version,
      }),
    );
    await ok(
      write(server, h.alice, competitionId, 'POST', `tasks/${second!.tasks[0]!.id}/remove`, {
        version: second!.version,
      }),
    );
    expect((await listOf(competitionId)).groups).toEqual([]);
    const left = h.database.db.raw.prepare('SELECT count(*) AS n FROM resources').get() as {
      n: number;
    };
    expect(left.n).toBeGreaterThan(0);
  });
});

describe('check results (R103, R84)', () => {
  it('write the status for local paths only, with no audit row and no version bump', async () => {
    const { competitionId } = await withWorkflow(server, h, h.alice);
    const owner = { ownerKind: 'ENGAGEMENT', ownerId: competitionId };
    const path = await added({ ...owner, uri: 'D:\\Shared\\brief.pdf', machineLabel: 'LAB-PC-07' });
    const link = await added({ ...owner, uri: 'https://example.org/b' });
    const before = auditRows(competitionId).length;
    const checkedAt = '2026-10-01T05:00:00.000Z';
    const response = await call(server, 'POST', '/api/v1/resources/check-results', {
      as: carol,
      body: {
        results: [
          { id: path.id, status: 'MISSING', checkedAt },
          { id: link.id, status: 'OK', checkedAt },
        ],
      },
    });
    expect(response.body).toEqual({ updated: 1 });
    const after = (await listOf(competitionId)).groups[0]!.resources;
    expect(after.find((r) => r.id === path.id)).toMatchObject({
      checkStatus: 'MISSING',
      lastCheckedAt: checkedAt,
      version: 1,
    });
    expect(after.find((r) => r.id === link.id)?.checkStatus).toBe('UNCHECKED');
    expect(auditRows(competitionId)).toHaveLength(before);
    // Moving the path is a person's edit: the old check no longer applies.
    const moved = await call(server, 'PATCH', `/api/v1/resources/${path.id}`, {
      as: h.alice,
      body: { uri: 'D:\\Shared\\brief-v2.pdf', version: 1 },
    });
    expect(moved.body).toMatchObject({ checkStatus: 'UNCHECKED', lastCheckedAt: null, version: 2 });
  });
});
