import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

/** Body of `POST /system/shutdown`; the work happens after the response is sent. */
export const ShutdownAccepted = z.object({
  accepted: z.literal(true),
});
export type ShutdownAccepted = z.infer<typeof ShutdownAccepted>;

export interface SystemRouteOptions {
  /** Starts the graceful shutdown. Called once, after the 202 has been flushed. */
  readonly onShutdownRequested: () => void;
}

/**
 * `POST /system/shutdown` - the shell's "Exit completely" path (ARCHITECTURE.md
 * 3.2). In host mode the client secret is the only gate, because whoever holds
 * it already owns the machine. In server mode (client mode over LAN) this route
 * must additionally require an authenticated admin session; the policy module
 * from WP-08 is where that check will live.
 */
export const systemRoutes =
  (options: SystemRouteOptions): FastifyPluginCallbackZod =>
  (app, _opts, done) => {
    app.post(
      '/system/shutdown',
      { schema: { response: { 202: ShutdownAccepted } } },
      async (request, reply) => {
        request.log.info('shutdown requested over the API');
        await reply.status(202).send({ accepted: true as const });
        // Let the response reach the socket before the server stops accepting.
        setImmediate(options.onShutdownRequested);
        return reply;
      },
    );
    done();
  };
