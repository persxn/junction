import {
  ProfessorList,
  TeamAddMemberRequest,
  TeamAddMentorRequest,
  TeamCreateRequest,
  TeamDetail,
  TeamListQuery,
  TeamListResponse,
  TeamTransferPrimaryRequest,
  TeamUpdateMemberRequest,
  TeamUpdateRequest,
  TeamVersionRequest,
} from '@compintel/contracts';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { TeamsContext } from '../modules/teams/reader.js';
import type { TeamsModule } from '../modules/teams/wiring.js';
import { requireSession } from '../platform/authn.js';

/**
 * Teams, their members and mentors, and the professor picker (WP-18). Every
 * handler is one service call; permissions, audit and R95's rules live there.
 */

export interface TeamsRouteOptions {
  readonly teams: () => TeamsModule | undefined;
}

const Id = z.string().min(1).max(64);
const IdParams = z.object({ id: Id });
const MemberParams = z.object({ id: Id, memberId: Id });
const MentorParams = z.object({ id: Id, mentorId: Id });

function module(options: TeamsRouteOptions): TeamsModule {
  const resolved = options.teams();
  if (resolved === undefined) throw new Error('teams are not available on this backend');
  return resolved;
}

function contextOf(request: FastifyRequest): TeamsContext {
  return { actor: requireSession(request).user, requestId: request.id };
}

export const teamsRoutes =
  (options: TeamsRouteOptions): FastifyPluginCallbackZod =>
  (app, _opts, done) => {
    const reply = { 200: TeamDetail };

    app.get(
      '/teams',
      { schema: { querystring: TeamListQuery, response: { 200: TeamListResponse } } },
      (request) => module(options).records.list(contextOf(request), request.query),
    );
    app.post('/teams', { schema: { body: TeamCreateRequest, response: reply } }, (request) =>
      module(options).records.create(contextOf(request), request.body),
    );
    app.get('/teams/:id', { schema: { params: IdParams, response: reply } }, (request) =>
      module(options).records.get(contextOf(request), request.params.id),
    );
    app.patch(
      '/teams/:id',
      { schema: { params: IdParams, body: TeamUpdateRequest, response: reply } },
      (request) =>
        module(options).records.update(contextOf(request), request.params.id, request.body),
    );
    app.post(
      '/teams/:id/archive',
      { schema: { params: IdParams, body: TeamVersionRequest, response: reply } },
      (request) =>
        module(options).records.archive(
          contextOf(request),
          request.params.id,
          request.body.version,
        ),
    );
    app.post(
      '/teams/:id/unarchive',
      { schema: { params: IdParams, body: TeamVersionRequest, response: reply } },
      (request) =>
        module(options).records.unarchive(
          contextOf(request),
          request.params.id,
          request.body.version,
        ),
    );

    app.post(
      '/teams/:id/members',
      { schema: { params: IdParams, body: TeamAddMemberRequest, response: reply } },
      (request) => module(options).members.add(contextOf(request), request.params.id, request.body),
    );
    app.patch(
      '/teams/:id/members/:memberId',
      { schema: { params: MemberParams, body: TeamUpdateMemberRequest, response: reply } },
      (request) =>
        module(options).members.update(
          contextOf(request),
          request.params.id,
          request.params.memberId,
          request.body,
        ),
    );
    app.post(
      '/teams/:id/members/:memberId/leave',
      { schema: { params: MemberParams, body: TeamVersionRequest, response: reply } },
      (request) =>
        module(options).members.leave(
          contextOf(request),
          request.params.id,
          request.params.memberId,
          request.body.version,
        ),
    );

    app.post(
      '/teams/:id/mentors',
      { schema: { params: IdParams, body: TeamAddMentorRequest, response: reply } },
      (request) => module(options).mentors.add(contextOf(request), request.params.id, request.body),
    );
    app.post(
      '/teams/:id/mentors/:mentorId/end',
      { schema: { params: MentorParams, body: TeamVersionRequest, response: reply } },
      (request) =>
        module(options).mentors.end(
          contextOf(request),
          request.params.id,
          request.params.mentorId,
          request.body.version,
        ),
    );
    app.post(
      '/teams/:id/transfer-primary',
      { schema: { params: IdParams, body: TeamTransferPrimaryRequest, response: reply } },
      (request) =>
        module(options).mentors.transferPrimary(
          contextOf(request),
          request.params.id,
          request.body,
        ),
    );

    app.get('/professors', { schema: { response: { 200: ProfessorList } } }, (request) =>
      module(options).records.professors(contextOf(request)),
    );
    done();
  };
