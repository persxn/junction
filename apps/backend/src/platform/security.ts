import { timingSafeEqual } from 'node:crypto';

import cors from '@fastify/cors';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { Config } from './config.js';
import { forbidden, unauthorized } from './errors.js';

/** Header carrying the per-spawn client secret (ADR-0017). */
export const CLIENT_SECRET_HEADER = 'x-compintel-client';

/** Browser origins allowed to call the API: Tauri in production, Vite in dev (A3). */
export const ALLOWED_ORIGINS = ['http://tauri.localhost', 'http://localhost:5173'] as const;

/** Request headers the UI is allowed to send cross-origin. */
export const ALLOWED_HEADERS = [
  'Authorization',
  'X-CompIntel-Client',
  'Content-Type',
  'Last-Event-ID',
] as const;

const ALLOWED_METHODS = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'] as const;

/** The port actually in use, which `--port 0` only settles at listen time. */
function boundPort(app: FastifyInstance, request: FastifyRequest): number | undefined {
  const address = app.server.address();
  if (address !== null && typeof address === 'object') {
    return address.port;
  }
  return request.socket.localPort;
}

/** DNS-rebinding defence: only the two loopback spellings of our own port (A3). */
function hostAllowed(app: FastifyInstance, request: FastifyRequest): boolean {
  const host = request.headers.host;
  const port = boundPort(app, request);
  if (host === undefined || port === undefined) {
    return false;
  }
  return host === `127.0.0.1:${port.toString()}` || host === `localhost:${port.toString()}`;
}

function isAllowedOrigin(origin: string | undefined): boolean {
  return origin !== undefined && (ALLOWED_ORIGINS as readonly string[]).includes(origin);
}

/**
 * A CORS preflight from an allowlisted origin (ruling R9). The browser sends it
 * before it is allowed to attach `X-CompIntel-Client`, so demanding the secret
 * here would make every cross-origin call fail; the preflight itself carries no
 * data and reveals nothing beyond the allowlist.
 */
function isAllowlistedPreflight(request: FastifyRequest): boolean {
  return (
    request.method === 'OPTIONS' &&
    isAllowedOrigin(request.headers.origin) &&
    request.headers['access-control-request-method'] !== undefined
  );
}

/** Constant-time comparison that does not leak the expected length either. */
export function secretMatches(provided: string | undefined, expected: string): boolean {
  const expectedBytes = Buffer.from(expected, 'utf8');
  const providedBytes = Buffer.from(provided ?? '', 'utf8');
  if (providedBytes.length !== expectedBytes.length) {
    timingSafeEqual(expectedBytes, expectedBytes);
    return false;
  }
  return timingSafeEqual(providedBytes, expectedBytes);
}

function presentedSecret(request: FastifyRequest): string | undefined {
  const raw = request.headers[CLIENT_SECRET_HEADER];
  return typeof raw === 'string' ? raw : undefined;
}

/**
 * Installs the loopback hardening from ARCHITECTURE.md 10.3: Host allowlist,
 * then the client secret, then CORS. Registration order is the hook order, so
 * the secret check runs before `@fastify/cors` answers a preflight.
 */
export function registerSecurity(app: FastifyInstance, config: Config): void {
  app.addHook('onRequest', (request, _reply, done) => {
    if (!hostAllowed(app, request)) {
      done(
        forbidden(
          'The Host header does not name this backend.',
          'Call the backend on 127.0.0.1 using the base URL the shell handed over.',
        ),
      );
      return;
    }
    if (
      !isAllowlistedPreflight(request) &&
      !secretMatches(presentedSecret(request), config.clientSecret)
    ) {
      done(
        unauthorized(
          'A valid X-CompIntel-Client header is required.',
          'The secret changes on every backend start; ask the shell for it again.',
        ),
      );
      return;
    }
    done();
  });

  void app.register(cors, {
    origin: [...ALLOWED_ORIGINS],
    methods: [...ALLOWED_METHODS],
    allowedHeaders: [...ALLOWED_HEADERS],
    exposedHeaders: ['X-Request-Id'],
    credentials: false,
    maxAge: 600,
  });
}
