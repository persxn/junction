import {
  InterestCategoryParam,
  InterestTagOptions,
  InterestTagQuery,
  MyInterestsUpdate,
  MyInterestsView,
  SavedSearch,
  SavedSearchCreate,
  SavedSearchDeleteQuery,
  SavedSearchIdParam,
  SavedSearchList,
  SavedSearchPatch,
} from '@compintel/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import type { InterestsService } from '../modules/interests/service.js';
import type { SavedSearchService } from '../modules/saved-searches/service.js';
import { requireSession } from '../platform/authn.js';

/**
 * Saved searches and "My interests" (WP-24, R112–R113). Every route is the
 * signed-in person's own: another person's saved search answers 404. Nothing
 * here is audited — like Save and Hide, these are personal.
 */

export interface SavedSearchRouteOptions {
  readonly savedSearches: () => SavedSearchService | undefined;
  readonly interests: () => InterestsService | undefined;
}

function need<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`${what} are not available on this backend`);
  return value;
}

export const savedSearchRoutes =
  (options: SavedSearchRouteOptions): FastifyPluginCallbackZod =>
  (app, _opts, done) => {
    const searches = () => need(options.savedSearches(), 'saved searches');
    const interests = () => need(options.interests(), 'interests');

    app.get('/saved-searches', { schema: { response: { 200: SavedSearchList } } }, (r) =>
      searches().list(requireSession(r).user),
    );
    app.post(
      '/saved-searches',
      { schema: { body: SavedSearchCreate, response: { 201: SavedSearch } } },
      async (r, reply) => {
        const created = searches().create(requireSession(r).user, r.body);
        return reply.code(201).send(created);
      },
    );
    app.patch(
      '/saved-searches/:id',
      {
        schema: {
          params: SavedSearchIdParam,
          body: SavedSearchPatch,
          response: { 200: SavedSearch },
        },
      },
      (r) => searches().patch(requireSession(r).user, r.params.id, r.body),
    );
    app.delete(
      '/saved-searches/:id',
      { schema: { params: SavedSearchIdParam, querystring: SavedSearchDeleteQuery } },
      async (r, reply) => {
        searches().delete(requireSession(r).user, r.params.id, r.query.version);
        return reply.code(204).send();
      },
    );

    app.get('/me/interests', { schema: { response: { 200: MyInterestsView } } }, (r) =>
      interests().view(requireSession(r).user),
    );
    app.put(
      '/me/interests',
      { schema: { body: MyInterestsUpdate, response: { 200: MyInterestsView } } },
      (r) => interests().replace(requireSession(r).user, r.body),
    );
    app.post(
      '/me/interests/categories/:id',
      { schema: { params: InterestCategoryParam, response: { 200: MyInterestsView } } },
      (r) => interests().addCategory(requireSession(r).user, r.params.id),
    );
    app.delete(
      '/me/interests/categories/:id',
      { schema: { params: InterestCategoryParam, response: { 200: MyInterestsView } } },
      (r) => interests().removeCategory(requireSession(r).user, r.params.id),
    );
    app.get(
      '/me/interests/tag-options',
      { schema: { querystring: InterestTagQuery, response: { 200: InterestTagOptions } } },
      (r) => interests().tagOptions(requireSession(r).user, r.query.text),
    );
    done();
  };
