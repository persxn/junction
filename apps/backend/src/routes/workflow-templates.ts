import {
  TemplateCloneRequest,
  TemplateMoveRequest,
  TemplateStageAddRequest,
  TemplateStageUpdateRequest,
  TemplateUpdateRequest,
  TemplateVersionRequest,
  WorkflowTemplateDetail,
  WorkflowTemplateList,
} from '@compintel/contracts';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { TemplatesContext } from '../modules/workflows/templates.js';
import type { WorkflowsModule } from '../modules/workflows/wiring.js';
import { requireSession } from '../platform/authn.js';

/** `/workflow-templates` (WP-20a step 5): list, get, clone, edit, stages, archive. */

export interface WorkflowTemplatesRouteOptions {
  readonly workflows: () => WorkflowsModule | undefined;
}

const Id = z.string().min(1).max(64);
const IdParams = z.object({ id: Id });
const StageParams = z.object({ id: Id, stageId: Id });

function module(options: WorkflowTemplatesRouteOptions): WorkflowsModule {
  const resolved = options.workflows();
  if (resolved === undefined) throw new Error('workflows are not available on this backend');
  return resolved;
}

const contextOf = (request: FastifyRequest): TemplatesContext => ({
  actor: requireSession(request).user,
  requestId: request.id,
});

export const workflowTemplatesRoutes =
  (options: WorkflowTemplatesRouteOptions): FastifyPluginCallbackZod =>
  (app, _opts, done) => {
    const t = () => module(options).templates;
    const reply = { 200: WorkflowTemplateDetail };

    app.get(
      '/workflow-templates',
      { schema: { response: { 200: WorkflowTemplateList } } },
      (request) => t().list(contextOf(request)),
    );
    app.get(
      '/workflow-templates/:id',
      { schema: { params: IdParams, response: reply } },
      (request) => t().get(contextOf(request), request.params.id),
    );
    app.post(
      '/workflow-templates/:id/clone',
      { schema: { params: IdParams, body: TemplateCloneRequest, response: reply } },
      (request) => t().clone(contextOf(request), request.params.id, request.body),
    );
    app.patch(
      '/workflow-templates/:id',
      { schema: { params: IdParams, body: TemplateUpdateRequest, response: reply } },
      (request) => t().update(contextOf(request), request.params.id, request.body),
    );
    app.post(
      '/workflow-templates/:id/archive',
      { schema: { params: IdParams, body: TemplateVersionRequest, response: reply } },
      (request) => t().archive(contextOf(request), request.params.id, request.body.versionNo),
    );
    app.post(
      '/workflow-templates/:id/stages',
      { schema: { params: IdParams, body: TemplateStageAddRequest, response: reply } },
      (request) => t().addStage(contextOf(request), request.params.id, request.body),
    );
    app.patch(
      '/workflow-templates/:id/stages/:stageId',
      { schema: { params: StageParams, body: TemplateStageUpdateRequest, response: reply } },
      (request) =>
        t().updateStage(
          contextOf(request),
          request.params.id,
          request.params.stageId,
          request.body,
        ),
    );
    app.post(
      '/workflow-templates/:id/stages/:stageId/remove',
      { schema: { params: StageParams, body: TemplateVersionRequest, response: reply } },
      (request) =>
        t().removeStage(
          contextOf(request),
          request.params.id,
          request.params.stageId,
          request.body.versionNo,
        ),
    );
    app.post(
      '/workflow-templates/:id/stages/:stageId/move',
      { schema: { params: StageParams, body: TemplateMoveRequest, response: reply } },
      (request) =>
        t().moveStage(contextOf(request), request.params.id, request.params.stageId, request.body),
    );
    done();
  };
