import {
  Category,
  CategoryCreate,
  CategoryList,
  CategoryPatch,
  CategoryRule,
  CategoryRuleCreate,
  CategoryRuleList,
  CategoryRulePatch,
  CategoryRulePreview,
  CategoryRulePreviewRequest,
  Uuid7,
} from '@compintel/contracts';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { CategoryAdminContext, CategoryAdminService } from '../modules/categories/admin.js';
import { requireSession } from '../platform/authn.js';

/**
 * Categories and their rules (§6.2 Taxonomy, §10.2 "categories & rules",
 * D-15, WP-15b). Administrators only; every write audited by the service.
 * `POST /admin/category-rules/preview` shows a rule's blast radius and writes
 * nothing.
 */

export interface CategoryRouteOptions {
  readonly categories: () => CategoryAdminService | undefined;
}

const IdParams = z.object({ id: z.string().min(1).max(64) });
const DeleteQuery = z.object({ reassign: Uuid7.optional() }).strict();
const RulesQuery = z.object({ categoryId: Uuid7.optional() }).strict();

function service(options: CategoryRouteOptions): CategoryAdminService {
  const resolved = options.categories();
  if (resolved === undefined) {
    throw new Error('categories are not available on this backend');
  }
  return resolved;
}

function contextOf(request: FastifyRequest): CategoryAdminContext {
  return { actor: requireSession(request).user, requestId: request.id };
}

export const categoryRoutes =
  (options: CategoryRouteOptions): FastifyPluginCallbackZod =>
  (app, _opts, done) => {
    app.get('/admin/categories', { schema: { response: { 200: CategoryList } } }, (request) => ({
      items: service(options).list(contextOf(request)),
    }));

    app.post(
      '/admin/categories',
      { schema: { body: CategoryCreate, response: { 201: Category } } },
      async (request, reply) =>
        reply.status(201).send(service(options).create(contextOf(request), request.body)),
    );

    app.patch(
      '/admin/categories/:id',
      { schema: { params: IdParams, body: CategoryPatch, response: { 200: Category } } },
      (request) => service(options).patch(contextOf(request), request.params.id, request.body),
    );

    app.delete(
      '/admin/categories/:id',
      { schema: { params: IdParams, querystring: DeleteQuery } },
      async (request, reply) => {
        service(options).delete(contextOf(request), request.params.id, request.query.reassign);
        return reply.status(204).send();
      },
    );

    app.get(
      '/admin/category-rules',
      { schema: { querystring: RulesQuery, response: { 200: CategoryRuleList } } },
      (request) => ({
        items: service(options).listRules(contextOf(request), request.query.categoryId),
      }),
    );

    app.post(
      '/admin/category-rules',
      { schema: { body: CategoryRuleCreate, response: { 201: CategoryRule } } },
      async (request, reply) =>
        reply.status(201).send(service(options).createRule(contextOf(request), request.body)),
    );

    app.post(
      '/admin/category-rules/preview',
      { schema: { body: CategoryRulePreviewRequest, response: { 200: CategoryRulePreview } } },
      (request) => service(options).preview(contextOf(request), request.body),
    );

    app.patch(
      '/admin/category-rules/:id',
      { schema: { params: IdParams, body: CategoryRulePatch, response: { 200: CategoryRule } } },
      (request) => service(options).patchRule(contextOf(request), request.params.id, request.body),
    );

    app.delete(
      '/admin/category-rules/:id',
      { schema: { params: IdParams } },
      async (request, reply) => {
        service(options).deleteRule(contextOf(request), request.params.id);
        return reply.status(204).send();
      },
    );

    done();
  };
