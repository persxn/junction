import {
  ResolvedTemplate,
  WorkflowTemplateDetail,
  WorkflowTemplateList,
  WorkflowView,
  type BackendConnection,
} from '@compintel/contracts';

import { apiGet, apiRequest, type HttpMethod } from './client.js';

/**
 * `/api/v1/workflow-templates…` and `/api/v1/competitions/:id/workflow…`
 * (WP-20a), parsed against the contract. Every workflow write answers with the
 * whole view, so the page replaces what it shows with the server's answer.
 */

const TEMPLATES = '/api/v1/workflow-templates';

export async function listTemplates(connection: BackendConnection): Promise<WorkflowTemplateList> {
  return WorkflowTemplateList.parse(await apiGet(connection, TEMPLATES));
}

export async function getTemplate(
  connection: BackendConnection,
  id: string,
): Promise<WorkflowTemplateDetail> {
  return WorkflowTemplateDetail.parse(await apiGet(connection, `${TEMPLATES}/${id}`));
}

/** A template write: `path` under the template, the method, the body (with `versionNo`). */
export async function templateWrite(
  connection: BackendConnection,
  id: string,
  path: string,
  method: HttpMethod,
  body: unknown,
): Promise<WorkflowTemplateDetail> {
  return WorkflowTemplateDetail.parse(
    await apiRequest(connection, `${TEMPLATES}/${id}${path}`, { method, body }),
  );
}

export const cloneTemplate = (
  connection: BackendConnection,
  id: string,
  name?: string,
): Promise<WorkflowTemplateDetail> =>
  templateWrite(connection, id, '/clone', 'POST', name === undefined ? {} : { name });

/** What a template gives this event: each stage's date, or none (R100). */
export async function resolveTemplate(
  connection: BackendConnection,
  templateId: string,
  eventId: string,
): Promise<ResolvedTemplate> {
  return ResolvedTemplate.parse(
    await apiRequest(connection, `${TEMPLATES}/${templateId}/resolve`, {
      method: 'POST',
      body: { eventId },
    }),
  );
}

const workflowPath = (competitionId: string): string =>
  `/api/v1/competitions/${competitionId}/workflow`;

export async function getWorkflow(
  connection: BackendConnection,
  competitionId: string,
): Promise<WorkflowView> {
  return WorkflowView.parse(await apiGet(connection, workflowPath(competitionId)));
}

/** One workflow write under `/competitions/:id/workflow/<path>`. */
export async function workflowWrite(
  connection: BackendConnection,
  competitionId: string,
  path: string,
  body: unknown,
  method: HttpMethod = 'POST',
): Promise<WorkflowView> {
  return WorkflowView.parse(
    await apiRequest(connection, `${workflowPath(competitionId)}/${path}`, { method, body }),
  );
}
