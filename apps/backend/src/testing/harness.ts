import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { API_VERSION } from '@compintel/contracts';
import { pino, type Logger } from 'pino';

import { buildApp, type App, type BuildAppOptions } from '../app.js';
import { sessionExpired } from '../modules/auth/errors.js';
import type { AuthService } from '../modules/auth/service.js';
import type { ActiveSession } from '../modules/auth/types.js';
import type { Config } from '../platform/config.js';
import { APP_VERSION } from '../platform/version.js';

/** Long enough to exercise the constant-time comparison honestly. */
export const TEST_CLIENT_SECRET = 'test-client-secret-0123456789abcdef';

/** The bearer token {@link authedFetch} sends and {@link stubAuth} accepts. */
export const TEST_SESSION_TOKEN = 'test-session-token';

/** The session {@link stubAuth} hands out. */
export const TEST_SESSION: ActiveSession = Object.freeze({
  id: 'test-session',
  user: {
    id: 'test-user',
    email: 'tester@example.edu',
    displayName: 'Tester',
    departmentId: null,
    status: 'ACTIVE' as const,
    mustChangePassword: false,
    roles: ['ADMINISTRATOR' as const, 'PROFESSOR' as const],
  },
  idleExpiresAt: Number.MAX_SAFE_INTEGER,
  absoluteExpiresAt: Number.MAX_SAFE_INTEGER,
});

/**
 * A stand-in authenticator for tests that are **not** about authentication —
 * error shapes, request logging, the Host allowlist. Since §10.3 put every route
 * behind a session, those tests would otherwise all assert 401 and stop testing
 * what they were written for.
 *
 * It accepts exactly one token and nothing else, so a test that forgets the
 * header still fails. Tests that *are* about auth build a real `AuthService`
 * over a real database (`testing/auth-server.ts`).
 */
export function stubAuth(): () => AuthService {
  const service = {
    authenticate: (token: string): ActiveSession => {
      if (token !== TEST_SESSION_TOKEN) {
        throw sessionExpired('This is not the test session token.');
      }
      return TEST_SESSION;
    },
  };
  return () => service as unknown as AuthService;
}

/**
 * A config that touches no disk: the harness logger is disabled, so `dataDir` is
 * never created. Tests that need real directories build their own config.
 */
export function testConfig(overrides: Partial<Config> = {}): Config {
  return Object.freeze({
    dataDir: path.join(tmpdir(), 'compintel-harness-unused'),
    host: '127.0.0.1' as const,
    port: 0,
    clientSecret: TEST_CLIENT_SECRET,
    clientSecretGenerated: false,
    dev: false,
    stdinLifeline: false,
    logLevel: 'silent' as const,
    appVersion: APP_VERSION,
    apiVersion: API_VERSION,
    ...overrides,
  });
}

export interface TestServer {
  readonly app: App;
  readonly config: Config;
  /** `http://127.0.0.1:<the port the OS handed out>`. */
  readonly baseUrl: string;
  close(): Promise<void>;
}

export interface StartTestServerOptions extends BuildAppOptions {
  readonly config?: Config;
  /** Runs before the instance boots, so a fixture route can still be added. */
  readonly extend?: (app: App) => void;
  /** Defaults to a disabled logger; pass one to inspect what gets logged. */
  readonly logger?: Logger;
}

/** A pino logger plus the JSON lines it has written, for logging assertions. */
export function capturingLogger(level = 'debug'): { logger: Logger; lines: () => unknown[] } {
  const raw: string[] = [];
  const logger = pino(
    { level, base: null, timestamp: false },
    { write: (chunk: string) => raw.push(chunk) },
  );
  const lines = (): unknown[] =>
    raw
      .join('')
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as unknown);
  return { logger, lines };
}

/**
 * Boots the real application on a loopback port. Security depends on the Host
 * header matching the bound port, so these tests speak HTTP for real rather than
 * going through `inject`.
 */
export async function startTestServer(options: StartTestServerOptions = {}): Promise<TestServer> {
  const config = options.config ?? testConfig();
  const app = buildApp(config, options.logger ?? pino({ enabled: false }), {
    auth: stubAuth(),
    ...options,
  });
  options.extend?.(app);

  await app.server.listen({ host: config.host, port: config.port });
  const address = app.server.server.address();
  if (address === null || typeof address !== 'object') {
    throw new Error('The test server did not report a TCP address.');
  }

  return {
    app,
    config,
    baseUrl: `http://127.0.0.1:${address.port.toString()}`,
    close: async () => {
      await app.server.close();
    },
  };
}

export interface RawResponse {
  readonly status: number;
  readonly headers: NodeJS.Dict<string | string[]>;
  readonly body: string;
}

/**
 * A request made with `node:http`. `fetch` silently drops a caller-supplied Host
 * header (it is a forbidden header name), so the DNS-rebinding defence can only
 * be exercised at this level.
 */
export function rawRequest(
  server: TestServer,
  options: { path: string; method?: string; headers?: Record<string, string> },
): Promise<RawResponse> {
  const url = new URL(server.baseUrl);
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        host: url.hostname,
        port: url.port,
        path: options.path,
        method: options.method ?? 'GET',
        headers: options.headers ?? {},
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          body += chunk;
        });
        response.on('end', () => {
          resolve({ status: response.statusCode ?? 0, headers: response.headers, body });
        });
      },
    );
    request.on('error', reject);
    request.end();
  });
}

/**
 * A request whose body is written after the headers, over `node:http`.
 *
 * `fetch` cannot be used for a body the server will refuse mid-upload: Fastify
 * answers 413 and hangs up while the client is still writing, and undici turns
 * that into a rejected promise with `ECONNRESET` instead of handing over the
 * response it already received.
 *
 * **Headers first, body only if it is still wanted** (pre-M2a item 8). Fastify
 * decides the body limit from `Content-Length` alone, so flushing the headers
 * and waiting is enough to get the real 413 with its problem document — and a
 * megabyte that is never written cannot lose the race it used to lose one run in
 * three, where the write failed with EPIPE before the response callback ran and
 * neither half of the promise ever settled. A server that really does want the
 * body gets it after {@link HEADER_GRACE_MS}, and a silent one fails on the
 * socket timeout instead of hanging until the suite's.
 */

/** How long the server gets to answer on the headers alone. */
const HEADER_GRACE_MS = 250;

/** The socket must say something within this, or the helper gives up. */
const RAW_REQUEST_TIMEOUT_MS = 5_000;

export function rawRequestWithBody(
  server: TestServer,
  options: { path: string; method?: string; headers?: Record<string, string>; body: string },
): Promise<RawResponse> {
  const url = new URL(server.baseUrl);
  const body = Buffer.from(options.body, 'utf8');
  return new Promise((resolve, reject) => {
    let settled = false;
    let answered = false;
    const request = httpRequest(
      {
        host: url.hostname,
        port: url.port,
        path: options.path,
        method: options.method ?? 'POST',
        headers: {
          'Content-Length': String(body.byteLength),
          ...(options.headers ?? {}),
        },
      },
      (response) => {
        answered = true;
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          text += chunk;
        });
        const finish = (): void => {
          if (settled) {
            return;
          }
          settled = true;
          resolve({ status: response.statusCode ?? 0, headers: response.headers, body: text });
          // Nothing is owed to a server that has already answered.
          request.destroy();
        };
        response.on('end', finish);
        // The server may destroy the socket the moment it has answered; the
        // status line and headers are already in hand, so that is not an error.
        response.on('aborted', finish);
        response.on('error', finish);
      },
    );

    const grace = setTimeout(() => {
      if (!answered && !settled) {
        request.end(body);
      }
    }, HEADER_GRACE_MS);

    request.setTimeout(RAW_REQUEST_TIMEOUT_MS, () => {
      if (!settled) {
        settled = true;
        clearTimeout(grace);
        request.destroy();
        reject(new Error(`${options.path} neither answered nor closed within the socket timeout`));
      }
    });

    request.on('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(grace);
      // An EPIPE or ECONNRESET on the write side means the refusal arrived while
      // the body was going out, which is the behaviour under test — the response
      // half settles. Only a socket that dies with no answer at all is a failure.
      if (settled || answered) {
        return;
      }
      settled = true;
      reject(error);
    });
    request.on('close', () => {
      clearTimeout(grace);
    });

    request.flushHeaders();
  });
}

/**
 * `fetch` with both headers the UI always sends: the per-spawn client secret and
 * the bearer token (ADR-0017). The token is {@link TEST_SESSION_TOKEN}, which
 * only {@link stubAuth} accepts.
 */
export function authedFetch(
  server: TestServer,
  path_: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`${server.baseUrl}${path_}`, {
    ...init,
    headers: {
      'X-CompIntel-Client': server.config.clientSecret,
      Authorization: `Bearer ${TEST_SESSION_TOKEN}`,
      ...(init.headers ?? {}),
    },
  });
}
