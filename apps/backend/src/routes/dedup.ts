import {
  DedupCandidateDto,
  DedupCandidateList,
  DedupCandidateQuery,
  EventChangePage,
  EventChangesQuery,
  EventConflicts,
  MergeRequest,
  MergeResult,
  RejectRequest,
  UnmergeRequest,
  UnmergeResult,
} from '@compintel/contracts';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { MergeContext } from '../modules/events/merge.js';
import type { DedupReviewService } from '../modules/events/review.js';
import { requireSession } from '../platform/authn.js';

/**
 * The duplicate review API (§7.5, §10.2 "Review/merge/unmerge duplicates") and
 * an event's conflicts and change history.
 *
 * Every write is admin-only — the service asserts it, not this file — carries
 * the row's `version` (a stale one is a 409), and is audited in the same
 * transaction as the change. There is no UI yet (WP-16b) and no job: linking
 * runs inline with ingest (R22 lists no dedup job).
 */

export interface DedupRouteOptions {
  readonly review: () => DedupReviewService | undefined;
}

const IdParams = z.object({ id: z.string().min(1).max(64) });

function service(options: DedupRouteOptions): DedupReviewService {
  const resolved = options.review();
  if (resolved === undefined) {
    throw new Error('duplicate review is not available on this backend');
  }
  return resolved;
}

function contextOf(request: FastifyRequest): MergeContext {
  return { actor: requireSession(request).user, requestId: request.id };
}

export const dedupRoutes =
  (options: DedupRouteOptions): FastifyPluginCallbackZod =>
  (app, _opts, done) => {
    app.get(
      '/admin/dedup/candidates',
      { schema: { querystring: DedupCandidateQuery, response: { 200: DedupCandidateList } } },
      (request) => service(options).listCandidates(contextOf(request), request.query),
    );

    app.post(
      '/admin/dedup/candidates/:id/merge',
      { schema: { params: IdParams, body: MergeRequest, response: { 200: MergeResult } } },
      (request) =>
        service(options).merge(contextOf(request), request.params.id, request.body.version),
    );

    app.post(
      '/admin/dedup/candidates/:id/reject',
      { schema: { params: IdParams, body: RejectRequest, response: { 200: DedupCandidateDto } } },
      (request) =>
        service(options).reject(contextOf(request), request.params.id, request.body.version),
    );

    app.post(
      '/admin/events/:id/unmerge',
      { schema: { params: IdParams, body: UnmergeRequest, response: { 200: UnmergeResult } } },
      (request) =>
        service(options).unmerge(contextOf(request), request.params.id, request.body.version),
    );

    app.get(
      '/events/:id/conflicts',
      { schema: { params: IdParams, response: { 200: EventConflicts } } },
      (request) => service(options).conflicts(contextOf(request), request.params.id),
    );

    app.get(
      '/events/:id/changes',
      {
        schema: {
          params: IdParams,
          querystring: EventChangesQuery,
          response: { 200: EventChangePage },
        },
      },
      (request) =>
        service(options).changes(
          contextOf(request),
          request.params.id,
          request.query.limit,
          request.query.cursor,
        ),
    );

    done();
  };
