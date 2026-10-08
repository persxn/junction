import type {
  CompetitionDetail,
  CompetitionListResponse,
  EngagementStatus,
  OutcomeView,
} from '@compintel/contracts';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { assigned, freshStudent, makeEvent, move } from '../../testing/competitions.js';
import type { TestServer } from '../../testing/harness.js';
import {
  call,
  openStudentsHarness,
  startStudentsServer,
  type StudentsHarness,
} from '../../testing/students.js';
import { OutcomesRepository } from './repository.js';

/**
 * Outcomes over HTTP (WP-21, R104): when one may be recorded, the move to
 * COMPLETED in the same unit of work, the field rules, currencies kept apart,
 * the certificate as an OUTCOME resource, edits and removal.
 */

let h: StudentsHarness;
let server: TestServer;
beforeAll(async () => {
  h = openStudentsHarness();
  server = await startStudentsServer(h);
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await server.close();
  h.close();
});

const PATHS: Record<EngagementStatus, EngagementStatus[]> = {
  CONSIDERING: [],
  ASSIGNED: [],
  APPLIED: ['APPLIED'],
  PARTICIPATING: ['APPLIED', 'PARTICIPATING'],
  COMPLETED: ['APPLIED', 'PARTICIPATING', 'COMPLETED'],
  WITHDRAWN: ['WITHDRAWN'],
  NOT_SELECTED: ['APPLIED', 'NOT_SELECTED'],
};

async function at(status: EngagementStatus): Promise<CompetitionDetail> {
  let current = await assigned(server, h.alice, {
    eventId: makeEvent(h),
    studentIds: [freshStudent(h)],
    initialStatus: status === 'CONSIDERING' ? 'CONSIDERING' : 'ASSIGNED',
  });
  for (const step of PATHS[status]) {
    current = (await move(server, h.alice, current, step)).body as unknown as CompetitionDetail;
  }
  return current;
}

const put = (id: string, body: Record<string, unknown>) =>
  call(server, 'PUT', `/api/v1/competitions/${id}/outcome`, { as: h.alice, body });
const page = async (id: string): Promise<CompetitionDetail> =>
  (await call(server, 'GET', `/api/v1/competitions/${id}`, { as: h.alice }))
    .body as unknown as CompetitionDetail;
const count = (sql: string, id: string): number =>
  (h.database.db.raw.prepare(sql).get(id) as { n: number }).n;

describe('when (R104)', () => {
  it('from PARTICIPATING it completes the competition in the same entry', async () => {
    const competition = await at('PARTICIPATING');
    const historyBefore = count(
      'SELECT count(*) AS n FROM engagement_status_history WHERE engagement_id = ?',
      competition.id,
    );
    const response = await put(competition.id, { result: 'WINNER', rank: 1 });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toMatchObject({
      result: 'WINNER',
      rank: 1,
      version: 1,
      recordedBy: 'Alice Professor',
    });
    const after = await page(competition.id);
    expect(after.status).toBe('COMPLETED');
    expect(after.history.at(-1)).toMatchObject({ from: 'PARTICIPATING', to: 'COMPLETED' });
    expect(
      count(
        'SELECT count(*) AS n FROM engagement_status_history WHERE engagement_id = ?',
        competition.id,
      ),
    ).toBe(historyBefore + 1);
    expect(after.outcome?.result).toBe('WINNER');
  });

  it('from COMPLETED it records without another move', async () => {
    const competition = await at('COMPLETED');
    expect((await put(competition.id, { result: 'FINALIST' })).status).toBe(200);
    expect((await page(competition.id)).history.at(-1)?.to).toBe('COMPLETED');
  });

  it.each(['CONSIDERING', 'ASSIGNED', 'APPLIED', 'WITHDRAWN', 'NOT_SELECTED'] as const)(
    'is refused from %s with 409 OUTCOME_NOT_ALLOWED',
    async (status) => {
      const competition = await at(status);
      const response = await put(competition.id, { result: 'PARTICIPATED' });
      expect(response.status).toBe(409);
      expect(response.body.code).toBe('OUTCOME_NOT_ALLOWED');
      expect((await page(competition.id)).status).toBe(status);
    },
  );

  it('a write failing mid-way leaves the competition PARTICIPATING with no history row', async () => {
    const competition = await at('PARTICIPATING');
    const history = count(
      'SELECT count(*) AS n FROM engagement_status_history WHERE engagement_id = ?',
      competition.id,
    );
    vi.spyOn(OutcomesRepository.prototype, 'insert').mockImplementation(() => {
      throw new Error('disk full');
    });
    expect((await put(competition.id, { result: 'WINNER' })).status).toBe(500);
    vi.restoreAllMocks();
    expect((await page(competition.id)).status).toBe('PARTICIPATING');
    expect(
      count(
        'SELECT count(*) AS n FROM engagement_status_history WHERE engagement_id = ?',
        competition.id,
      ),
    ).toBe(history);
  });
});

describe('the fields (R104, R63)', () => {
  it.each([
    [{ prizeMinor: 100 }, 'needs its currency'],
    [{ prizeMinor: 100, prizeCurrency: 'usd' }, 'capitals'],
    [{ rank: 0 }, 'from 1 up'],
    [{ resultUrl: 'javascript:alert(1)' }, 'http or https'],
  ])('refuses %j', async (fields, words) => {
    const competition = await at('COMPLETED');
    const response = await put(competition.id, { result: 'WINNER', ...fields });
    expect(response.status).toBe(422);
    expect(response.body.code).toBe('OUTCOME_INVALID');
    expect(String(response.body.detail)).toContain(words);
  });

  it('keeps each amount in its own currency; nothing converts or sums them', async () => {
    const a = await at('COMPLETED');
    const b = await at('COMPLETED');
    await put(a.id, { result: 'WINNER', prizeMinor: 5_000_000, prizeCurrency: 'INR' });
    await put(b.id, { result: 'RUNNER_UP', prizeMinor: 50_000, prizeCurrency: 'USD' });
    expect((await page(a.id)).outcome).toMatchObject({
      prizeMinor: 5_000_000,
      prizeCurrency: 'INR',
    });
    expect((await page(b.id)).outcome).toMatchObject({ prizeMinor: 50_000, prizeCurrency: 'USD' });
    const list = (
      await call(server, 'GET', '/api/v1/competitions?includeClosed=true', { as: h.alice })
    ).body as unknown as CompetitionListResponse;
    expect(list.items.find((item) => item.id === a.id)?.result).toBe('WINNER');
    expect(JSON.stringify(list)).not.toContain('5050000');
  });
});

describe('editing, the certificate, removing', () => {
  it('adds a certificate in the same form; removing that resource leaves the outcome without one', async () => {
    const competition = await at('COMPLETED');
    const recorded = (
      await put(competition.id, {
        result: 'WINNER',
        certificate: { uri: 'https://example.org/certificate.pdf' },
      })
    ).body as unknown as OutcomeView;
    expect(recorded.certificate).toMatchObject({
      ownerKind: 'OUTCOME',
      ownerId: competition.id,
      label: 'Certificate',
    });
    const removed = await call(server, 'DELETE', `/api/v1/resources/${recorded.certificate!.id}`, {
      as: h.alice,
      body: { version: 1 },
    });
    expect(removed.status).toBe(204);
    expect((await page(competition.id)).outcome?.certificate).toBeNull();
  });

  it('edits in place with its version; a stale one is refused; removing keeps COMPLETED', async () => {
    const competition = await at('COMPLETED');
    await put(competition.id, { result: 'FINALIST' });
    const stale = await put(competition.id, { result: 'WINNER' });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('OUTCOME_VERSION_CONFLICT');
    expect(stale.body.detail).toBe('Someone else changed this — reload to see their change.');
    const edited = await put(competition.id, { result: 'WINNER', version: 1 });
    expect(edited.body).toMatchObject({
      result: 'WINNER',
      version: 2,
      recordedBy: 'Alice Professor',
    });
    const gone = await call(server, 'DELETE', `/api/v1/competitions/${competition.id}/outcome`, {
      as: h.alice,
      body: { version: 2 },
    });
    expect(gone.status).toBe(204);
    const after = await page(competition.id);
    expect(after).toMatchObject({ status: 'COMPLETED', outcome: null });
    const actions = h.database.db.raw
      .prepare(
        "SELECT action FROM audit_log WHERE entity_id = ? AND action LIKE 'outcome.%' ORDER BY rowid",
      )
      .all(competition.id) as { action: string }[];
    expect(actions.map((row) => row.action)).toEqual([
      'outcome.recorded',
      'outcome.updated',
      'outcome.removed',
    ]);
  });

  it('a professor who does not mentor it gets 403', async () => {
    const competition = await at('COMPLETED');
    const response = await call(server, 'PUT', `/api/v1/competitions/${competition.id}/outcome`, {
      as: h.bob,
      body: { result: 'WINNER' },
    });
    expect(response.status).toBe(403);
  });
});
