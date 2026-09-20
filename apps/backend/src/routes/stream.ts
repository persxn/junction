import type { OutgoingHttpHeaders } from 'node:http';

import type { StreamEvent } from '@compintel/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import { requireSession } from '../platform/authn.js';
import {
  formatSseEvent,
  HEARTBEAT_INTERVAL_MS,
  parseLastEventId,
  SSE_HEARTBEAT,
  type StreamHub,
} from '../platform/stream.js';

export interface StreamRouteOptions {
  readonly hub: StreamHub;
  /** Injected in tests so a heartbeat does not take fifteen real seconds. */
  readonly heartbeatMs?: number;
}

/**
 * `GET /api/v1/stream` (ruling R36, ADR-0017, §4.4).
 *
 * It is an ordinary authenticated route, which is the whole point of reading it
 * with `fetch` + `ReadableStream` instead of `EventSource`: the client secret
 * and the bearer token travel in headers like everywhere else, and there is no
 * token in a URL to end up in a log.
 *
 * The response is written by hand rather than through a serializer: SSE is a
 * stream of framed text, and Fastify's reply lifecycle would want to end it.
 */
export const streamRoutes =
  (options: StreamRouteOptions): FastifyPluginCallbackZod =>
  (app, _opts, done) => {
    app.get('/stream', (request, reply) => {
      // Not decorative: it is what makes an unauthenticated stream a 401 rather
      // than an open socket that never says anything.
      const session = requireSession(request);

      // `writeHead` writes straight to the socket, so everything Fastify has
      // queued on the reply — `@fastify/cors`'s `Access-Control-Allow-Origin`
      // above all, and `X-Request-Id` — has to be carried over by hand. Without
      // it the browser blocks the response it just preflighted successfully, and
      // the UI sees a stream that drops the instant it opens.
      const queued: OutgoingHttpHeaders = {};
      for (const [name, value] of Object.entries(reply.getHeaders())) {
        if (value !== undefined) {
          queued[name] = value;
        }
      }

      reply.raw.writeHead(200, {
        ...queued,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        // The WebView sits behind nothing, but a future LAN deployment may not.
        'X-Accel-Buffering': 'no',
      });

      const write = (chunk: string): void => {
        if (!reply.raw.writableEnded) {
          reply.raw.write(chunk);
        }
      };

      // Anything the client missed while it was away, before anything new.
      const lastEventId = parseLastEventId(request.headers['last-event-id']);
      for (const missed of options.hub.replay(lastEventId)) {
        write(formatSseEvent(missed));
      }

      // One event on connect, so the client can tell "open" from "opening", and
      // can see whether its replay was complete.
      const ready = options.hub.publish('stream.ready', {
        sessionId: session.id,
        resumedFrom: lastEventId ?? 0,
        replayComplete: !options.hub.replayGap(lastEventId),
      });
      // `publish` already sent it to everyone *else*; this subscriber is not
      // attached yet, so it is written here and skipped below.
      write(formatSseEvent(ready));

      const heartbeat = setInterval(() => {
        write(SSE_HEARTBEAT);
      }, options.heartbeatMs ?? HEARTBEAT_INTERVAL_MS);
      heartbeat.unref?.();

      let finished = false;
      const finish = (): void => {
        if (finished) {
          return;
        }
        finished = true;
        clearInterval(heartbeat);
        unsubscribe();
        if (!reply.raw.writableEnded) {
          reply.raw.end();
        }
      };

      const unsubscribe = options.hub.subscribe({
        send: (event: StreamEvent) => {
          if (event.id > ready.id) {
            write(formatSseEvent(event));
          }
        },
        close: finish,
      });

      request.raw.on('close', finish);
      request.raw.on('error', finish);

      // Fastify must not try to send a body of its own.
      return reply;
    });

    done();
  };
