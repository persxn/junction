import {
  EraseStudentRequest,
  StartMentorshipRequest,
  StudentAchievementInput,
  StudentCreateRequest,
  StudentDetail,
  StudentFormOptions,
  StudentImportCommitRequest,
  StudentImportCommitResult,
  StudentImportPreview,
  StudentImportPreviewRequest,
  StudentListQuery,
  StudentListResponse,
  StudentSettings,
  StudentTagsRequest,
  StudentUpdateRequest,
  StudentVersionRequest,
  TagSuggestionQuery,
  TagSuggestions,
} from '@compintel/contracts';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { StudentsContext } from '../modules/students/mappers.js';
import type { StudentsModule } from '../modules/students/wiring.js';
import { requireSession } from '../platform/authn.js';

/**
 * Students, mentorships, the import and the student settings (WP-17).
 *
 * Every handler is one call: who may do what, what is audited and what R92
 * keeps out of the audit chain are all decided in the services (R32).
 */

export interface StudentsRouteOptions {
  readonly students: () => StudentsModule | undefined;
}

const Id = z.string().min(1).max(64);
const IdParams = z.object({ id: Id });
const AchievementParams = z.object({ id: Id, achievementId: Id });

function module(options: StudentsRouteOptions): StudentsModule {
  const resolved = options.students();
  if (resolved === undefined) throw new Error('students are not available on this backend');
  return resolved;
}

function contextOf(request: FastifyRequest): StudentsContext {
  return { actor: requireSession(request).user, requestId: request.id };
}

export const studentsRoutes =
  (options: StudentsRouteOptions): FastifyPluginCallbackZod =>
  (app, _opts, done) => {
    const reply = { 200: StudentDetail };

    app.get(
      '/students',
      { schema: { querystring: StudentListQuery, response: { 200: StudentListResponse } } },
      (request) => module(options).records.list(contextOf(request), request.query),
    );
    app.get('/students/options', { schema: { response: { 200: StudentFormOptions } } }, (request) =>
      module(options).records.formOptions(contextOf(request)),
    );
    app.post('/students', { schema: { body: StudentCreateRequest, response: reply } }, (request) =>
      module(options).records.create(contextOf(request), request.body),
    );
    app.get('/students/:id', { schema: { params: IdParams, response: reply } }, (request) =>
      module(options).records.get(contextOf(request), request.params.id),
    );
    app.patch(
      '/students/:id',
      { schema: { params: IdParams, body: StudentUpdateRequest, response: reply } },
      (request) =>
        module(options).records.update(contextOf(request), request.params.id, request.body),
    );

    app.put(
      '/students/:id/tags',
      { schema: { params: IdParams, body: StudentTagsRequest, response: reply } },
      (request) =>
        module(options).relations.setTags(contextOf(request), request.params.id, request.body),
    );
    app.post(
      '/students/:id/achievements',
      { schema: { params: IdParams, body: StudentAchievementInput, response: reply } },
      (request) =>
        module(options).relations.addAchievement(
          contextOf(request),
          request.params.id,
          request.body,
        ),
    );
    app.patch(
      '/students/:id/achievements/:achievementId',
      { schema: { params: AchievementParams, body: StudentAchievementInput, response: reply } },
      (request) =>
        module(options).relations.updateAchievement(
          contextOf(request),
          request.params.id,
          request.params.achievementId,
          request.body,
        ),
    );
    app.delete(
      '/students/:id/achievements/:achievementId',
      { schema: { params: AchievementParams, response: reply } },
      (request) =>
        module(options).relations.deleteAchievement(
          contextOf(request),
          request.params.id,
          request.params.achievementId,
        ),
    );
    app.post(
      '/students/:id/mentorships',
      { schema: { params: IdParams, body: StartMentorshipRequest.nullish(), response: reply } },
      (request) =>
        module(options).relations.startMentorship(
          contextOf(request),
          request.params.id,
          request.body ?? {},
        ),
    );
    app.post('/mentorships/:id/end', { schema: { params: IdParams, response: reply } }, (request) =>
      module(options).relations.endMentorship(contextOf(request), request.params.id),
    );

    app.post(
      '/students/:id/deactivate',
      { schema: { params: IdParams, body: StudentVersionRequest, response: reply } },
      (request) =>
        module(options).lifecycle.deactivate(contextOf(request), request.params.id, request.body),
    );
    app.post(
      '/students/:id/reactivate',
      { schema: { params: IdParams, body: StudentVersionRequest, response: reply } },
      (request) =>
        module(options).lifecycle.reactivate(contextOf(request), request.params.id, request.body),
    );
    app.post(
      '/admin/students/:id/erase',
      { schema: { params: IdParams, body: EraseStudentRequest, response: reply } },
      (request) =>
        module(options).lifecycle.erase(contextOf(request), request.params.id, request.body),
    );
    app.get(
      '/admin/settings/students',
      { schema: { response: { 200: StudentSettings } } },
      (request) => module(options).lifecycle.settings(contextOf(request)),
    );
    app.put(
      '/admin/settings/students',
      { schema: { body: StudentSettings, response: { 200: StudentSettings } } },
      (request) => module(options).lifecycle.updateSettings(contextOf(request), request.body),
    );

    app.post(
      '/students/import/preview',
      { schema: { body: StudentImportPreviewRequest, response: { 200: StudentImportPreview } } },
      (request) => module(options).imports.preview(contextOf(request), request.body),
    );
    app.post(
      '/students/import/commit',
      {
        schema: { body: StudentImportCommitRequest, response: { 200: StudentImportCommitResult } },
      },
      (request) => module(options).imports.commit(contextOf(request), request.body),
    );

    app.get(
      '/tags',
      { schema: { querystring: TagSuggestionQuery, response: { 200: TagSuggestions } } },
      (request) => module(options).relations.suggestTags(contextOf(request), request.query),
    );
    done();
  };
