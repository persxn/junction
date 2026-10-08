import {
  ApplyDateChangesRequest,
  MoveRequest,
  ResolvedTemplate,
  ResolveTemplateRequest,
  StageAddRequest,
  StageAssigneesRequest,
  StageOverrideRequest,
  StageStatusRequest,
  StageUpdateRequest,
  TaskAddRequest,
  TaskDoneRequest,
  TaskUpdateRequest,
  VersionRequest,
  WorkflowView,
} from '@compintel/contracts';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { assertCan } from '../modules/auth/policy.js';
import type { WorkflowsContext } from '../modules/workflows/workflow-reader.js';
import type { WorkflowsModule } from '../modules/workflows/wiring.js';
import { requireSession } from '../platform/authn.js';

/**
 * A competition's workflow (WP-20a step 7) under `/competitions/:id/workflow`
 * — WP-19 named the resource "competitions", so its workflow lives there too —
 * and the review step's date preview under `/workflow-templates/:id/resolve`.
 */

export interface WorkflowsRouteOptions {
  readonly workflows: () => WorkflowsModule | undefined;
}

const Id = z.string().min(1).max(64);
const P = z.object({ id: Id });
const S = z.object({ id: Id, stageId: Id });
const T = z.object({ id: Id, taskId: Id });
const TemplateP = z.object({ templateId: Id });

function module(options: WorkflowsRouteOptions): WorkflowsModule {
  const resolved = options.workflows();
  if (resolved === undefined) throw new Error('workflows are not available on this backend');
  return resolved;
}

const contextOf = (request: FastifyRequest): WorkflowsContext => ({
  actor: requireSession(request).user,
  requestId: request.id,
});

export const workflowsRoutes =
  (options: WorkflowsRouteOptions): FastifyPluginCallbackZod =>
  (app, _opts, done) => {
    const m = (): WorkflowsModule => module(options);
    const reply = { 200: WorkflowView };
    const base = '/competitions/:id/workflow';

    app.get(base, { schema: { params: P, response: reply } }, (request) => {
      const context = contextOf(request);
      assertCan(context.actor, 'competition.view');
      return m().reader.view(context.actor, request.params.id);
    });
    app.post(
      `${base}/stages`,
      { schema: { params: P, body: StageAddRequest, response: reply } },
      (r) => m().stages.add(contextOf(r), r.params.id, r.body),
    );
    app.patch(
      `${base}/stages/:stageId`,
      { schema: { params: S, body: StageUpdateRequest, response: reply } },
      (r) => m().stages.update(contextOf(r), r.params.id, r.params.stageId, r.body),
    );
    app.post(
      `${base}/stages/:stageId/remove`,
      { schema: { params: S, body: VersionRequest, response: reply } },
      (r) => m().stages.remove(contextOf(r), r.params.id, r.params.stageId, r.body.version),
    );
    app.post(
      `${base}/stages/:stageId/move`,
      { schema: { params: S, body: MoveRequest, response: reply } },
      (r) => m().stages.move(contextOf(r), r.params.id, r.params.stageId, r.body),
    );
    app.post(
      `${base}/stages/:stageId/status`,
      { schema: { params: S, body: StageStatusRequest, response: reply } },
      (r) => m().stages.setStatus(contextOf(r), r.params.id, r.params.stageId, r.body),
    );
    app.post(
      `${base}/stages/:stageId/override`,
      { schema: { params: S, body: StageOverrideRequest, response: reply } },
      (r) => m().stages.setOverride(contextOf(r), r.params.id, r.params.stageId, r.body),
    );
    app.put(
      `${base}/stages/:stageId/assignees`,
      { schema: { params: S, body: StageAssigneesRequest, response: reply } },
      (r) => m().stages.setAssignees(contextOf(r), r.params.id, r.params.stageId, r.body),
    );
    app.post(
      `${base}/stages/:stageId/tasks`,
      { schema: { params: S, body: TaskAddRequest, response: reply } },
      (r) => m().tasks.add(contextOf(r), r.params.id, r.params.stageId, r.body),
    );
    app.patch(
      `${base}/tasks/:taskId`,
      { schema: { params: T, body: TaskUpdateRequest, response: reply } },
      (r) => m().tasks.update(contextOf(r), r.params.id, r.params.taskId, r.body),
    );
    app.post(
      `${base}/tasks/:taskId/move`,
      { schema: { params: T, body: MoveRequest, response: reply } },
      (r) => m().tasks.move(contextOf(r), r.params.id, r.params.taskId, r.body),
    );
    app.post(
      `${base}/tasks/:taskId/remove`,
      { schema: { params: T, body: VersionRequest, response: reply } },
      (r) => m().tasks.remove(contextOf(r), r.params.id, r.params.taskId, r.body.version),
    );
    app.post(
      `${base}/tasks/:taskId/done`,
      { schema: { params: T, body: TaskDoneRequest, response: reply } },
      (r) => m().tasks.setDone(contextOf(r), r.params.id, r.params.taskId, r.body),
    );
    app.post(
      `${base}/apply-date-changes`,
      { schema: { params: P, body: ApplyDateChangesRequest, response: reply } },
      (r) => m().stages.applyDateChanges(contextOf(r), r.params.id, r.body),
    );
    app.post(
      '/workflow-templates/:templateId/resolve',
      {
        schema: {
          params: TemplateP,
          body: ResolveTemplateRequest,
          response: { 200: ResolvedTemplate },
        },
      },
      (r) => {
        assertCan(contextOf(r).actor, 'competition.view');
        return m().copier.resolve(r.params.templateId, r.body.eventId);
      },
    );
    done();
  };
