import {
  TransferCommitRequest,
  TransferPreview,
  TransferRequest,
  TransferResult,
} from '@compintel/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import type { TransferModule } from '../modules/transfer/wiring.js';
import { requireSession } from '../platform/authn.js';

/** Ownership transfer (WP-21, R105): Admin → Users → Transfer ownership… */

export interface TransferRouteOptions {
  readonly transfer: () => TransferModule | undefined;
}

export const transferRoutes =
  (options: TransferRouteOptions): FastifyPluginCallbackZod =>
  (app, _opts, done) => {
    const m = (): TransferModule => {
      const resolved = options.transfer();
      if (resolved === undefined) throw new Error('ownership transfer is not available here');
      return resolved;
    };
    app.post(
      '/admin/ownership-transfer/preview',
      { schema: { body: TransferRequest, response: { 200: TransferPreview } } },
      (r) => m().service.preview(requireSession(r).user, r.body),
    );
    app.post(
      '/admin/ownership-transfer/commit',
      { schema: { body: TransferCommitRequest, response: { 200: TransferResult } } },
      (r) => m().service.commit({ actor: requireSession(r).user, requestId: r.id }, r.body),
    );
    done();
  };
