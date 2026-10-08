import {
  ENGAGEMENT_STATUS_LABELS,
  ENGAGEMENT_TRANSITIONS,
  problemType,
  type AssignPreview,
  type CompetitionDetail,
  type CompetitionEvent,
  type CompetitionListItem,
  type EngagementStatus,
  type TeamDetail,
} from '@compintel/contracts';
import { vi } from 'vitest';

import { TEST_USER } from './auth.js';
import { PROFESSORS } from './teams-api.js';
import { installResourcesApi, type ResourcesApi } from './resources-api.js';
import { installWorkflowsApi, type WorkflowsApi } from './workflows-api.js';

/**
 * The competitions backend, as far as the WP-19 screens can tell — in memory,
 * synthetic only (D-33). It answers `/competitions…`, the team list and the
 * professors itself and hands every other request to whatever fake was
 * installed before it (search, students), so a screen sees one backend.
 */

const AT = '2026-10-08T06:00:00.000Z';
const DAY = 86_400_000;
const id = (n: number): string => `0192f0c1-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;
let serial = 0;
const next = (): string => {
  serial += 1;
  return id(0xe000 + serial);
};

export function makeEvent(n: number, patch: Partial<CompetitionEvent> = {}): CompetitionEvent {
  return {
    id: id(0xd000 + n),
    title: `Synthetic Hack ${String(n)}`,
    eventType: 'HACKATHON',
    registrationDeadlineAt: Date.parse('2026-10-20T00:00:00.000Z'),
    registrationDeadlinePrecision: 'DATE',
    startsAt: null,
    datePrecision: 'UNKNOWN',
    endsAt: null,
    timezone: 'Asia/Kolkata',
    cancellation: 'NONE',
    teamMin: null,
    teamMax: null,
    ...patch,
  };
}

export function makeCompetition(
  event: CompetitionEvent,
  patch: Partial<CompetitionDetail> = {},
): CompetitionDetail {
  const status = patch.status ?? 'ASSIGNED';
  return {
    id: next(),
    status,
    kind: 'TEAM',
    event,
    team: { id: id(0xb001), name: 'Team Rocket' },
    student: null,
    primaryMentor: { userId: TEST_USER.id, displayName: TEST_USER.displayName },
    rosterCount: 0,
    nextDeadline: {
      kind: 'REGISTRATION',
      at: Date.parse('2026-10-20T00:00:00.000Z'),
      precision: 'DATE',
    },
    statusChangedAt: AT,
    isMine: true,
    progress: null,
    health: null,
    healthReason: null,
    can: { edit: true, manageMentors: true },
    version: 1,
    roster: [],
    pastRoster: [],
    mentors: [
      {
        id: next(),
        userId: TEST_USER.id,
        displayName: TEST_USER.displayName,
        role: 'PRIMARY',
        fromAt: AT,
        toAt: null,
      },
    ],
    pastMentors: [],
    history: [
      {
        id: next(),
        from: null,
        to: status,
        changedBy: TEST_USER.displayName,
        changedAt: AT,
        note: null,
      },
    ],
    notes: null,
    createdAt: AT,
    allowed: [...ENGAGEMENT_TRANSITIONS[status]],
    ...patch,
  };
}

export interface CompetitionsApiOptions {
  readonly competitions?: CompetitionDetail[];
  readonly teams?: TeamDetail[];
  readonly events?: CompetitionEvent[];
  /** Students already active on an event elsewhere: studentId → competition name (A14). */
  readonly activeElsewhere?: Record<string, string>;
}

export interface CompetitionsApi {
  readonly competitions: Map<string, CompetitionDetail>;
  readonly calls: {
    method: string;
    path: string;
    query: string;
    body: Record<string, unknown> | undefined;
  }[];
  /** WP-20a's templates and workflows, answered in front of this fake. */
  readonly workflows: WorkflowsApi;
  /** WP-20b's resources, answered in front of both. */
  readonly resources: ResourcesApi;
}

function respond(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

const problem = (status: number, code: string, detail: string, extra: object = {}): Response =>
  respond(status, {
    type: problemType(code as never),
    title: detail,
    status,
    code,
    detail,
    requestId: 'r',
    ...extra,
  });

const listItem = ({
  roster: _r,
  pastRoster: _p,
  mentors: _m,
  pastMentors: _pm,
  history: _h,
  notes: _n,
  createdAt: _c,
  allowed: _a,
  ...item
}: CompetitionDetail): CompetitionListItem => item;

export function installCompetitionsApi(options: CompetitionsApiOptions = {}): CompetitionsApi {
  const delegate = globalThis.fetch;
  const competitions = new Map((options.competitions ?? []).map((c) => [c.id, c]));
  const teams = options.teams ?? [];
  const events = new Map((options.events ?? []).map((event) => [event.id, event]));
  const calls: CompetitionsApi['calls'] = [];

  const save = (competition: CompetitionDetail): Response => {
    const saved = {
      ...competition,
      version: competition.version + 1,
      rosterCount: competition.roster.length,
      allowed: [...ENGAGEMENT_TRANSITIONS[competition.status]],
    };
    competitions.set(saved.id, saved);
    return respond(200, saved);
  };

  const plan = (body: Record<string, unknown>): AssignPreview => {
    const event = events.get(String(body.eventId)) ?? makeEvent(0, { id: String(body.eventId) });
    const team = teams.find((candidate) => candidate.id === body.teamId);
    const roster = (team?.members ?? []).map((member) => ({
      studentId: member.studentId,
      fullName: member.fullName,
      universityId: member.universityId,
      roleLabel: member.roleLabel,
    }));
    const conflicts = roster.flatMap((entry) => {
      const other = options.activeElsewhere?.[entry.studentId];
      return other === undefined
        ? []
        : [
            {
              studentId: entry.studentId,
              fullName: entry.fullName,
              competitionId: id(0xf001),
              competitionName: other,
              message: `${entry.fullName} is already in ${other} for this event.`,
            },
          ];
    });
    const closing =
      event.registrationDeadlineAt !== null && event.registrationDeadlineAt - Date.now() < 3 * DAY;
    return {
      event,
      competitions: [
        {
          kind: 'TEAM',
          teamName: team?.name ?? null,
          roster,
          mentors: [{ userId: TEST_USER.id, displayName: TEST_USER.displayName, role: 'PRIMARY' }],
        },
      ],
      leftOut: [],
      conflicts,
      warnings: closing
        ? [{ code: 'REGISTRATION_CLOSING', message: 'Registration closes in 2 days.' }]
        : [],
      canAssign: conflicts.length === 0 && roster.length > 0,
    };
  };

  const route = (
    method: string,
    path: string,
    params: URLSearchParams,
    body: Record<string, unknown> | undefined,
  ): Response | undefined => {
    if (path === '/api/v1/professors') return respond(200, { professors: PROFESSORS });
    if (path === '/api/v1/teams' && method === 'GET') {
      const items = teams.map((team) => ({
        id: team.id,
        name: team.name,
        status: team.status,
        memberCount: team.members.length,
        primaryMentor: { userId: TEST_USER.id, displayName: TEST_USER.displayName },
        coverage: team.coverage.counts,
        isMine: team.mentors.some((mentor) => mentor.userId === TEST_USER.id),
        version: team.version,
      }));
      return respond(200, { items, total: items.length });
    }
    if (path === '/api/v1/competitions' && method === 'GET') {
      const statuses = params.get('status')?.split(',');
      const items = [...competitions.values()]
        .filter((c) => statuses === undefined || statuses.includes(c.status))
        .filter(
          (c) =>
            statuses !== undefined ||
            params.get('includeClosed') === 'true' ||
            !['WITHDRAWN', 'NOT_SELECTED'].includes(c.status),
        )
        .map(listItem);
      return respond(200, { items, total: items.length });
    }
    if (path === '/api/v1/competitions/assign/preview') return respond(200, plan(body ?? {}));
    if (path === '/api/v1/competitions/assign') {
      const preview = plan(body ?? {});
      if (preview.conflicts.length > 0)
        return problem(409, 'ENGAGEMENT_STUDENT_ALREADY_ACTIVE', preview.conflicts[0]!.message);
      const status = (body?.initialStatus ?? 'ASSIGNED') as EngagementStatus;
      const team = teams.find((candidate) => candidate.id === body?.teamId);
      const made = makeCompetition(preview.event, {
        status,
        team: team === undefined ? null : { id: team.id, name: team.name },
        roster: preview.competitions[0]!.roster.map((entry) => ({
          ...entry,
          studentStatus: 'ACTIVE' as const,
          addedAt: AT,
          removedAt: null,
          removalReason: null,
        })),
        rosterCount: preview.competitions[0]!.roster.length,
        allowed: [...ENGAGEMENT_TRANSITIONS[status]],
      });
      competitions.set(made.id, made);
      return respond(200, { competitions: [listItem(made)] });
    }
    const match = /^\/api\/v1\/competitions\/([^/]+)(?:\/(.+))?$/.exec(path);
    if (match === null) return undefined;
    const competition = competitions.get(match[1] ?? '');
    if (competition === undefined)
      return problem(404, 'ENGAGEMENT_NOT_FOUND', 'That competition does not exist.');
    const rest = match[2];
    if (method === 'GET' && rest === undefined) return respond(200, competition);
    if (body?.version !== competition.version)
      return problem(
        409,
        'ENGAGEMENT_VERSION_CONFLICT',
        'Someone else changed this competition — reload to see their changes.',
      );
    if (rest === 'transitions') {
      const to = body.to as EngagementStatus;
      const allowed = ENGAGEMENT_TRANSITIONS[competition.status];
      if (!allowed.includes(to)) {
        const from = ENGAGEMENT_STATUS_LABELS[competition.status];
        return problem(
          409,
          'ENGAGEMENT_INVALID_TRANSITION',
          `Can't move from ${from} to ${ENGAGEMENT_STATUS_LABELS[to]}. From ${from}: ${allowed.map((s) => ENGAGEMENT_STATUS_LABELS[s]).join(' or ')}.`,
          { allowed },
        );
      }
      return save({
        ...competition,
        status: to,
        history: [
          ...competition.history,
          {
            id: next(),
            from: competition.status,
            to,
            changedBy: TEST_USER.displayName,
            changedAt: AT,
            note: null,
          },
        ],
      });
    }
    if (rest === 'participants') {
      const studentId = String(body.studentId);
      const other = options.activeElsewhere?.[studentId];
      if (other !== undefined)
        return problem(
          409,
          'ENGAGEMENT_STUDENT_ALREADY_ACTIVE',
          `That student is already in ${other} for this event.`,
        );
      const past = competition.pastRoster.find((entry) => entry.studentId === studentId);
      return save({
        ...competition,
        pastRoster: competition.pastRoster.filter((entry) => entry.studentId !== studentId),
        roster: [
          ...competition.roster,
          {
            studentId,
            fullName: past?.fullName ?? 'Picked Student',
            universityId: past?.universityId ?? 'PICK0001',
            studentStatus: 'ACTIVE',
            roleLabel: (body.roleLabel as string | null | undefined) ?? null,
            addedAt: AT,
            removedAt: null,
            removalReason: null,
          },
        ],
      });
    }
    const remove = /^participants\/([^/]+)\/remove$/.exec(rest ?? '');
    if (remove !== null) {
      const entry = competition.roster.find((row) => row.studentId === remove[1]);
      if (entry === undefined)
        return problem(404, 'ENGAGEMENT_PARTICIPANT_NOT_FOUND', 'Not on the roster.');
      return save({
        ...competition,
        roster: competition.roster.filter((row) => row.studentId !== entry.studentId),
        pastRoster: [
          ...competition.pastRoster,
          { ...entry, removedAt: AT, removalReason: 'REMOVED' },
        ],
      });
    }
    if (rest === undefined && method === 'PATCH')
      return save({ ...competition, notes: (body.notes as string | null) ?? null });
    return problem(404, 'NOT_FOUND', 'Not found');
  };

  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      const parsed = new URL(url);
      const body =
        typeof init.body === 'string'
          ? (JSON.parse(init.body) as Record<string, unknown>)
          : undefined;
      const answer = route(method, parsed.pathname, parsed.searchParams, body);
      if (answer === undefined) return delegate(url, init);
      calls.push({ method, path: parsed.pathname, query: parsed.search, body });
      return Promise.resolve(answer);
    }),
  );
  const workflows = installWorkflowsApi({ competitions });
  return { competitions, calls, workflows, resources: installResourcesApi() };
}
