import {
  CreateUserRequest,
  TemporaryPasswordResult,
  UpdateUserRequest,
  UserListResponse,
  UserResponse,
} from '@compintel/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { requireSession } from '../platform/authn.js';
import type { UsersService, UsersServiceContext } from '../modules/users/service.js';
import type { FastifyRequest } from 'fastify';

export interface AdminUsersRouteOptions {
  readonly users: () => UsersService | undefined;
}

const UserParams = z.object({ id: z.string().min(1) });

function service(options: AdminUsersRouteOptions): UsersService {
  const resolved = options.users();
  if (resolved === undefined) {
    throw new Error('user administration is not available on this backend');
  }
  return resolved;
}

/** The acting principal and the request id, threaded into the audit trail. */
function contextOf(request: FastifyRequest): UsersServiceContext {
  return { actor: requireSession(request).user, requestId: request.id };
}

/**
 * `/admin/users` (§10.2 `user.manage`, roadmap WP-07b).
 *
 * Every handler is two lines because every rule — who may call it, whether the
 * last administrator is about to vanish, what gets audited — lives in
 * `UsersService`. The routes only translate HTTP into a method call, which is
 * ruling R32's "routes never decide" applied literally.
 */
export const adminUsersRoutes =
  (options: AdminUsersRouteOptions): FastifyPluginCallbackZod =>
  (app, _opts, done) => {
    app.get('/admin/users', { schema: { response: { 200: UserListResponse } } }, (request) => ({
      users: [...service(options).list(contextOf(request))],
    }));

    app.post(
      '/admin/users',
      { schema: { body: CreateUserRequest, response: { 200: TemporaryPasswordResult } } },
      async (request) => service(options).create(contextOf(request), request.body),
    );

    app.patch(
      '/admin/users/:id',
      {
        schema: { params: UserParams, body: UpdateUserRequest, response: { 200: UserResponse } },
      },
      (request) => ({
        user: service(options).update(contextOf(request), request.params.id, request.body),
      }),
    );

    app.post(
      '/admin/users/:id/disable',
      { schema: { params: UserParams, response: { 200: UserResponse } } },
      (request) => ({
        user: service(options).setEnabled(contextOf(request), request.params.id, false),
      }),
    );

    app.post(
      '/admin/users/:id/enable',
      { schema: { params: UserParams, response: { 200: UserResponse } } },
      (request) => ({
        user: service(options).setEnabled(contextOf(request), request.params.id, true),
      }),
    );

    // The new password is in the response and nowhere else: not in the log, not
    // in the audit row, not in a second GET.
    app.post(
      '/admin/users/:id/reset-password',
      { schema: { params: UserParams, response: { 200: TemporaryPasswordResult } } },
      async (request) => service(options).resetPassword(contextOf(request), request.params.id),
    );

    done();
  };
