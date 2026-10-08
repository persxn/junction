import {
  ENGAGEMENT_TRANSITIONS,
  problemType,
  type CompetitionDetail,
  type OutcomeView,
  type StudentHistory,
} from '@compintel/contracts';
import { vi } from 'vitest';

/**
 * The WP-21 backend for the screens, in memory (D-33): recording, editing and
 * removing a competition's outcome against the competitions fake's map, and a
 * student's history from a map the test fills. Everything else goes on.
 */

export interface OutcomesApi {
  readonly histories: Map<string, StudentHistory>;
  readonly calls: { method: string; path: string; body: Record<string, unknown> | undefined }[];
}

const respond = (status: number, body: unknown): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(status === 204 ? '' : JSON.stringify(body)),
  }) as unknown as Response;

const problem = (status: number, code: string, detail: string): Response =>
  respond(status, {
    type: problemType(code as never),
    title: detail,
    status,
    code,
    detail,
    requestId: 'r',
  });

export function installOutcomesApi(competitions: Map<string, CompetitionDetail>): OutcomesApi {
  const delegate = globalThis.fetch;
  const histories = new Map<string, StudentHistory>();
  const calls: OutcomesApi['calls'] = [];

  const route = (method: string, path: string, body: Record<string, unknown>) => {
    const history = /^\/api\/v1\/students\/([^/]+)\/history$/.exec(path);
    if (history !== null) {
      const found = histories.get(history[1] ?? '');
      return found === undefined
        ? respond(200, {
            studentId: history[1],
            erased: false,
            competitions: [],
            teams: [],
            achievements: [],
          })
        : respond(200, found);
    }
    const match = /^\/api\/v1\/competitions\/([^/]+)\/outcome$/.exec(path);
    if (match === null) return undefined;
    const competition = competitions.get(match[1] ?? '');
    if (competition === undefined)
      return problem(404, 'ENGAGEMENT_NOT_FOUND', 'No such competition.');
    if (body.version !== (competition.outcome?.version ?? undefined)) {
      return problem(
        409,
        'OUTCOME_VERSION_CONFLICT',
        'Someone else changed this — reload to see their change.',
      );
    }
    if (method === 'DELETE') {
      competitions.set(competition.id, { ...competition, outcome: null, result: null });
      return respond(204, undefined);
    }
    if (competition.status !== 'PARTICIPATING' && competition.status !== 'COMPLETED') {
      return problem(
        409,
        'OUTCOME_NOT_ALLOWED',
        'Record the result once the competition is underway.',
      );
    }
    if (
      (body.prizeMinor === null || body.prizeMinor === undefined) !==
      (body.prizeCurrency === null || body.prizeCurrency === undefined)
    ) {
      return problem(
        422,
        'OUTCOME_INVALID',
        'A prize amount needs its currency, and a currency needs an amount.',
      );
    }
    const outcome: OutcomeView = {
      competitionId: competition.id,
      result: body.result as OutcomeView['result'],
      rank: (body.rank as number | null | undefined) ?? null,
      prizeText: (body.prizeText as string | null | undefined) ?? null,
      prizeMinor: (body.prizeMinor as number | null | undefined) ?? null,
      prizeCurrency: (body.prizeCurrency as string | null | undefined) ?? null,
      certificate: competition.outcome?.certificate ?? null,
      resultUrl: (body.resultUrl as string | null | undefined) ?? null,
      notes: (body.notes as string | null | undefined) ?? null,
      feedback: (body.feedback as string | null | undefined) ?? null,
      recordedBy: competition.outcome?.recordedBy ?? 'Test Professor',
      recordedAt: competition.outcome?.recordedAt ?? '2026-10-08T06:00:00.000Z',
      version: (competition.outcome?.version ?? 0) + 1,
    };
    competitions.set(competition.id, {
      ...competition,
      status: 'COMPLETED',
      allowed: [...ENGAGEMENT_TRANSITIONS.COMPLETED],
      version: competition.status === 'COMPLETED' ? competition.version : competition.version + 1,
      outcome,
      result: outcome.result,
    });
    return respond(200, outcome);
  };

  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      const path = new URL(url).pathname;
      const body =
        typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
      const answer = route(method, path, body);
      if (answer === undefined) return delegate(url, init);
      calls.push({ method, path, body: init.body === undefined ? undefined : body });
      return Promise.resolve(answer);
    }),
  );
  return { histories, calls };
}
