import { StreamHub } from '../platform/stream.js';
import { createAuthHarness, type AuthHarness, type AuthHarnessOptions } from './auth.js';
import { startTestServer, type TestServer } from './harness.js';

/**
 * A real HTTP server backed by a real database and a real `AuthService`.
 *
 * The API-level tests speak HTTP for the same reason WP-04a's did: the Host
 * allowlist and the client-secret hook are part of what is being tested, and
 * `inject` would skip both.
 */

export interface AuthTestServer {
  readonly server: TestServer;
  readonly auth: AuthHarness;
  readonly hub: StreamHub;
  close(): Promise<void>;
}

export interface AuthTestServerOptions extends AuthHarnessOptions {
  /** Short enough that a heartbeat test does not take fifteen seconds. */
  readonly streamHeartbeatMs?: number;
}

export async function startAuthTestServer(
  options: AuthTestServerOptions = {},
): Promise<AuthTestServer> {
  const auth = createAuthHarness(options);
  const hub = new StreamHub();
  const server = await startTestServer({
    auth: () => auth.service,
    streamHub: hub,
    ...(options.streamHeartbeatMs === undefined
      ? {}
      : { streamHeartbeatMs: options.streamHeartbeatMs }),
  });
  return {
    server,
    auth,
    hub,
    close: async () => {
      await server.close();
      auth.close();
    },
  };
}

/** Signs in over HTTP and returns the bearer token. */
export async function signIn(
  harness: AuthTestServer,
  email: string,
  password: string,
): Promise<string> {
  const response = await fetch(`${harness.server.baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: {
      'X-CompIntel-Client': harness.server.config.clientSecret,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) {
    throw new Error(`login failed with ${response.status.toString()}: ${await response.text()}`);
  }
  const body = (await response.json()) as { token: string };
  return body.token;
}

/** `fetch` with the client secret and, optionally, a bearer token. */
export function call(
  harness: AuthTestServer,
  path: string,
  options: {
    token?: string;
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    'X-CompIntel-Client': harness.server.config.clientSecret,
    ...(options.token === undefined ? {} : { Authorization: `Bearer ${options.token}` }),
    ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    ...options.headers,
  };
  return fetch(`${harness.server.baseUrl}${path}`, {
    method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
}
