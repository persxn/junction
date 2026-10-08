import {
  AddParticipantRequest,
  AssignPreview,
  AssignRequest,
  AssignResult,
  CompetitionAddMentorRequest,
  CompetitionDetail,
  CompetitionListResponse,
  CompetitionQuery,
  CompetitionTransferRequest,
  CompetitionUpdateRequest,
  CompetitionVersionRequest,
  TransitionRequest,
} from '@compintel/contracts';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { EngagementsContext } from '../modules/engagements/reader.js';
import type { EngagementsModule } from '../modules/engagements/wiring.js';
import { requireSession } from '../platform/authn.js';

/**
 * Competitions (WP-19, R96–R98) under `/competitions` — the UI's word; the
 * tables say "engagements". Every handler is one service call.
 */

export interface CompetitionsRouteOptions {
  readonly competitions: () => EngagementsModule | undefined;
}

const Id = z.string().min(1).max(64);
const IdParams = z.object({ id: Id });
const StudentParams = z.object({ id: Id, studentId: Id });
const MentorParams = z.object({ id: Id, mentorId: Id });

function module(options: CompetitionsRouteOptions): EngagementsModule {
  const resolved = options.competitions();
  if (resolved === undefined) throw new Error('competitions are not available on this backend');
  return resolved;
}

function contextOf(request: FastifyRequest): EngagementsContext {
  return { actor: requireSession(request).user, requestId: request.id };
}

export const competitionsRoutes =
  (options: CompetitionsRouteOptions): FastifyPluginCallbackZod =>
  (app, _opts, done) => {
    const reply = { 200: CompetitionDetail };
    const m = (): EngagementsModule => module(options);

    app.get(
      '/competitions',
      { schema: { querystring: CompetitionQuery, response: { 200: CompetitionListResponse } } },
      (request) => m().records.list(contextOf(request), request.query),
    );
    app.post(
      '/competitions/assign/preview',
      { schema: { body: AssignRequest, response: { 200: AssignPreview } } },
      (request) => m().assign.preview(contextOf(request), request.body),
    );
    app.post(
      '/competitions/assign',
      { schema: { body: AssignRequest, response: { 200: AssignResult } } },
      (request) => m().assign.assign(contextOf(request), request.body),
    );
    app.get('/competitions/:id', { schema: { params: IdParams, response: reply } }, (request) =>
      m().records.get(contextOf(request), request.params.id),
    );
    app.patch(
      '/competitions/:id',
      { schema: { params: IdParams, body: CompetitionUpdateRequest, response: reply } },
      (request) => m().records.update(contextOf(request), request.params.id, request.body),
    );
    app.post(
      '/competitions/:id/transitions',
      { schema: { params: IdParams, body: TransitionRequest, response: reply } },
      (request) => m().records.transition(contextOf(request), request.params.id, request.body),
    );
    app.post(
      '/competitions/:id/participants',
      { schema: { params: IdParams, body: AddParticipantRequest, response: reply } },
      (request) => m().people.addParticipant(contextOf(request), request.params.id, request.body),
    );
    app.post(
      '/competitions/:id/participants/:studentId/remove',
      { schema: { params: StudentParams, body: CompetitionVersionRequest, response: reply } },
      (request) =>
        m().people.removeParticipant(
          contextOf(request),
          request.params.id,
          request.params.studentId,
          request.body.version,
        ),
    );
    app.post(
      '/competitions/:id/mentors',
      { schema: { params: IdParams, body: CompetitionAddMentorRequest, response: reply } },
      (request) => m().people.addMentor(contextOf(request), request.params.id, request.body),
    );
    app.post(
      '/competitions/:id/mentors/:mentorId/end',
      { schema: { params: MentorParams, body: CompetitionVersionRequest, response: reply } },
      (request) =>
        m().people.endMentor(
          contextOf(request),
          request.params.id,
          request.params.mentorId,
          request.body.version,
        ),
    );
    app.post(
      '/competitions/:id/transfer-primary',
      { schema: { params: IdParams, body: CompetitionTransferRequest, response: reply } },
      (request) => m().people.transferPrimary(contextOf(request), request.params.id, request.body),
    );
    done();
  };
