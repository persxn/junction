import {
  problemType,
  type CoverageChip,
  type StudentDetail,
  type TeamAbilities,
  type TeamDetail,
  type TeamListItem,
  type TeamMember,
  type TeamMentor,
} from '@compintel/contracts';
import { vi } from 'vitest';

import { TEST_USER } from './auth.js';
import { installStudentsApi, OTHER_PROFESSOR, type StudentsApi } from './students-api.js';

/**
 * The teams backend, as far as the WP-18 screens can tell — in memory, over the
 * students fake (synthetic people only, D-33). Membership changes are written
 * back to the students' `teams`, so the Student page sees them as it would the
 * real reader's. Every answer is shaped like the real one, so the client's
 * contract parse runs on it.
 */

const AT = '2026-10-02T10:00:00.000Z';
const id = (n: number): string => `0192f0c1-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;

export const PROFESSORS = [
  { userId: TEST_USER.id, displayName: TEST_USER.displayName },
  { userId: OTHER_PROFESSOR, displayName: 'Grace Hopper' },
  { userId: id(0xa003), displayName: 'Alan Turing' },
];

const ALL: TeamAbilities = {
  edit: true,
  archive: true,
  manageMentors: true,
  transferPrimary: true,
};

let serial = 0;
const next = (): string => {
  serial += 1;
  return id(0xc000 + serial);
};

export function memberOf(student: StudentDetail, patch: Partial<TeamMember> = {}): TeamMember {
  return {
    id: next(),
    studentId: student.id,
    fullName: student.fullName,
    universityId: student.universityId,
    studentStatus: student.status,
    skills: student.tags.filter((tag) => tag.relation === 'SKILL').map((tag) => tag.name),
    roleLabel: null,
    isLead: false,
    joinedAt: AT,
    leftAt: null,
    ...patch,
  };
}

export function primaryOf(userId = TEST_USER.id): TeamMentor {
  const person = PROFESSORS.find((p) => p.userId === userId) ?? PROFESSORS[0]!;
  return {
    id: next(),
    userId,
    displayName: person.displayName,
    role: 'PRIMARY',
    fromAt: AT,
    toAt: null,
  };
}

export function makeTeam(n: number, patch: Partial<TeamDetail> = {}): TeamDetail {
  return {
    id: id(0xb000 + n),
    name: `Demo Team ${String(n)}`,
    description: null,
    status: 'ACTIVE',
    createdAt: AT,
    members: [],
    pastMembers: [],
    mentors: [primaryOf()],
    pastMentors: [],
    targets: [],
    coverage: { chips: [], counts: { covered: 0, thin: 0, missing: 0 } },
    can: ALL,
    version: 1,
    ...patch,
  };
}

/** A plain R94: two holders or more is Covered, one is Thin, a target nobody holds is Missing. */
function withCoverage(team: TeamDetail): TeamDetail {
  const holders = new Map<string, number>();
  for (const member of team.members) {
    if (member.studentStatus !== 'ACTIVE') continue;
    for (const skill of member.skills) holders.set(skill, (holders.get(skill) ?? 0) + 1);
  }
  const names = [...new Set([...team.targets, ...holders.keys()])];
  const chips: CoverageChip[] = names.map((name) => {
    const count = holders.get(name) ?? 0;
    return {
      name,
      holders: count,
      isTarget: team.targets.includes(name),
      state: count >= 2 ? 'COVERED' : count === 1 ? 'THIN' : 'MISSING',
    };
  });
  const count = (state: CoverageChip['state']) =>
    chips.filter((chip) => chip.state === state).length;
  return {
    ...team,
    coverage: {
      chips,
      counts: { covered: count('COVERED'), thin: count('THIN'), missing: count('MISSING') },
    },
  };
}

function listItem(team: TeamDetail): TeamListItem {
  const primary = team.mentors.find((mentor) => mentor.role === 'PRIMARY');
  return {
    id: team.id,
    name: team.name,
    status: team.status,
    memberCount: team.members.length,
    primaryMentor:
      primary === undefined ? null : { userId: primary.userId, displayName: primary.displayName },
    coverage: team.coverage.counts,
    isMine: team.mentors.some((mentor) => mentor.userId === TEST_USER.id),
    version: team.version,
  };
}

export interface TeamsApiOptions {
  readonly teams?: TeamDetail[];
  readonly students?: StudentDetail[];
  /** The next team write answers 409 TEAM_VERSION_CONFLICT. */
  readonly conflictOnce?: boolean;
}

export interface TeamsApi extends StudentsApi {
  readonly teams: Map<string, TeamDetail>;
  readonly teamCalls: {
    method: string;
    path: string;
    query: string;
    body: Record<string, unknown> | undefined;
  }[];
}

function respond(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

const problem = (status: number, code: string, detail: string): Response =>
  respond(status, {
    type: problemType(code as never),
    title: detail,
    status,
    code,
    detail,
    requestId: 'r',
  });

export function installTeamsApi(options: TeamsApiOptions = {}): TeamsApi {
  const students = installStudentsApi({ students: options.students ?? [] });
  const delegate = globalThis.fetch;
  const teams = new Map((options.teams ?? []).map((team) => [team.id, withCoverage(team)]));
  const teamCalls: TeamsApi['teamCalls'] = [];
  let conflict = options.conflictOnce === true;

  /** The students' `teams`, rebuilt from every team's memberships. */
  const syncStudents = (): void => {
    for (const student of students.students.values()) {
      const rows = [...teams.values()].flatMap((team) =>
        [...team.members, ...team.pastMembers]
          .filter((member) => member.studentId === student.id)
          .map((member) => ({
            teamId: team.id,
            teamName: team.name,
            teamStatus: team.status,
            roleLabel: member.roleLabel,
            isLead: member.isLead,
            joinedAt: member.joinedAt,
            leftAt: member.leftAt,
          })),
      );
      students.students.set(student.id, { ...student, teams: rows });
    }
  };
  syncStudents();

  const save = (team: TeamDetail): Response => {
    const saved = withCoverage({ ...team, version: team.version + 1 });
    teams.set(saved.id, saved);
    syncStudents();
    return respond(200, saved);
  };

  const join = (team: TeamDetail, body: Record<string, unknown>): Response => {
    const student = students.students.get(String(body.studentId));
    if (student === undefined) return problem(404, 'STUDENT_NOT_FOUND', 'No such student.');
    if (team.members.some((member) => member.studentId === student.id))
      return problem(409, 'TEAM_MEMBER_EXISTS', 'Already a member.');
    const isLead = body.isLead === true;
    return save({
      ...team,
      members: [
        ...team.members.map((member) => (isLead ? { ...member, isLead: false } : member)),
        memberOf(student, {
          roleLabel: typeof body.roleLabel === 'string' ? body.roleLabel : null,
          isLead,
        }),
      ],
    });
  };

  const route = (
    method: string,
    path: string,
    params: URLSearchParams,
    body: Record<string, unknown> | undefined,
  ): Response | undefined => {
    if (path === '/api/v1/professors') return respond(200, { professors: PROFESSORS });
    if (path === '/api/v1/teams' && method === 'GET') {
      const text = (params.get('text') ?? '').toLowerCase();
      const items = [...teams.values()]
        .map(listItem)
        .filter((team) => team.name.toLowerCase().includes(text))
        .filter((team) => params.get('status') === null || team.status === params.get('status'))
        .filter((team) => params.get('mentor') !== 'me' || team.isMine);
      return respond(200, { items, total: items.length });
    }
    if (path === '/api/v1/teams' && method === 'POST') {
      const team = makeTeam(900 + teams.size, {
        name: String(body?.name),
        targets: (body?.targets ?? []) as string[],
        version: 0,
      });
      teams.set(team.id, team);
      let saved = save(team);
      for (const member of (body?.members ?? []) as Record<string, unknown>[])
        saved = join(teams.get(team.id)!, member);
      return saved;
    }
    const match = /^\/api\/v1\/teams\/([^/]+)(?:\/(.+))?$/.exec(path);
    if (match === null) return undefined;
    const team = teams.get(match[1] ?? '');
    if (team === undefined) return problem(404, 'TEAM_NOT_FOUND', 'No such team.');
    const rest = match[2];
    if (method === 'GET' && rest === undefined) return respond(200, team);
    if (conflict) {
      conflict = false;
      return problem(409, 'TEAM_VERSION_CONFLICT', 'Someone else changed this team.');
    }
    if (body?.version !== team.version)
      return problem(409, 'TEAM_VERSION_CONFLICT', 'Someone else changed this team.');
    if (rest === 'archive') return save({ ...team, status: 'ARCHIVED' });
    if (rest === 'unarchive') return save({ ...team, status: 'ACTIVE' });
    if (team.status === 'ARCHIVED') return problem(409, 'TEAM_ARCHIVED', 'This team is archived.');
    if (rest === undefined && method === 'PATCH') {
      return save({
        ...team,
        ...(typeof body.name === 'string' ? { name: body.name } : {}),
        ...(body.description === undefined
          ? {}
          : { description: body.description as string | null }),
        ...(Array.isArray(body.targets) ? { targets: body.targets as string[] } : {}),
      });
    }
    if (rest === 'members') return join(team, body);
    const member = /^members\/([^/]+)(\/leave)?$/.exec(rest ?? '');
    if (member !== null) {
      const row = team.members.find((candidate) => candidate.id === member[1]);
      if (row === undefined) return problem(404, 'TEAM_MEMBER_NOT_FOUND', 'No such member.');
      if (member[2] !== undefined) {
        return save({
          ...team,
          members: team.members.filter((candidate) => candidate.id !== row.id),
          pastMembers: [...team.pastMembers, { ...row, isLead: false, leftAt: AT }],
        });
      }
      const isLead = typeof body.isLead === 'boolean' ? body.isLead : undefined;
      return save({
        ...team,
        members: team.members.map((candidate) =>
          candidate.id === row.id
            ? {
                ...candidate,
                ...(body.roleLabel === undefined
                  ? {}
                  : { roleLabel: body.roleLabel as string | null }),
                ...(isLead === undefined ? {} : { isLead }),
              }
            : isLead === true
              ? { ...candidate, isLead: false }
              : candidate,
        ),
      });
    }
    if (rest === 'mentors') {
      const person = PROFESSORS.find((p) => p.userId === body.userId);
      if (person === undefined)
        return problem(422, 'TEAM_MENTOR_NOT_PROFESSOR', 'Not a professor.');
      return save({
        ...team,
        mentors: [...team.mentors, { ...primaryOf(person.userId), role: 'CO_MENTOR' }],
      });
    }
    const end = /^mentors\/([^/]+)\/end$/.exec(rest ?? '');
    if (end !== null) {
      const row = team.mentors.find((candidate) => candidate.id === end[1]);
      if (row === undefined) return problem(404, 'TEAM_MENTOR_NOT_FOUND', 'No such mentor.');
      return save({
        ...team,
        mentors: team.mentors.filter((candidate) => candidate.id !== row.id),
        pastMentors: [...team.pastMentors, { ...row, toAt: AT }],
      });
    }
    if (rest === 'transfer-primary') {
      const old = team.mentors.find((mentor) => mentor.role === 'PRIMARY');
      const kept = team.mentors
        .filter((mentor) => mentor.userId !== body.toUserId)
        .flatMap((mentor) =>
          mentor.role !== 'PRIMARY'
            ? [mentor]
            : body.stepAway === true
              ? []
              : [{ ...mentor, role: 'CO_MENTOR' as const }],
        );
      return save({
        ...team,
        mentors: [primaryOf(String(body.toUserId)), ...kept],
        pastMentors:
          old === undefined ? team.pastMentors : [...team.pastMentors, { ...old, toAt: AT }],
      });
    }
    return problem(404, 'NOT_FOUND', 'Not found');
  };

  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      const parsed = new URL(url);
      const path = parsed.pathname;
      const body =
        typeof init.body === 'string'
          ? (JSON.parse(init.body) as Record<string, unknown>)
          : undefined;
      const answer = route(method, path, parsed.searchParams, body);
      if (answer === undefined) return delegate(url, init);
      teamCalls.push({ method, path, query: parsed.search, body });
      return Promise.resolve(answer);
    }),
  );
  return { ...students, teams, teamCalls };
}
