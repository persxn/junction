import {
  ApiTransport,
  HealthResponse,
  type ApiTransport as Transport,
  type BackendConnection as Connection,
  type HealthResponse as Health,
} from '@compintel/contracts';

import { backendConnection, backendRequest } from '../shell/backend.js';
import { authToken } from './auth-token.js';
import { ApiProblem, problemFromBody, unreachableProblem } from './problem.js';

/**
 * The client for the loopback REST API (ARCHITECTURE.md §4.4, ADR-0017).
 *
 * Three things it is responsible for and nothing else:
 *   - the headers every request carries: the per-spawn client secret, and the
 *     session bearer token once WP-07a has one;
 *   - turning an answer into data or into one `ApiProblem`;
 *   - which transport carries the request — direct `fetch`, or the shell's
 *     proxy when WebView2 refuses to reach loopback (finding F9). Ruling R78
 *     makes that proxy carry every method, so a write is not something the app
 *     can only do on some machines.
 *
 * There is no SSE client here; that is WP-07a (and ruling R30: SSE has no proxy,
 * so it degrades to polling rather than failing).
 */

/** Header every request to the loopback API carries (ADR-0017, ruling A2). */
export const CLIENT_SECRET_HEADER = 'X-CompIntel-Client';

/**
 * How long a direct request may take before it counts as a broken transport.
 *
 * With Chromium Local Network Access checks enabled, WebView2 does not reject the
 * request to `127.0.0.1` — it leaves the promise **pending**, so a fallback that
 * only watches for a rejection waits for ever (measured in WP-05b, see
 * docs/research/webview2-local-network-access.md). Ruling R27 sets this at 2 s:
 * long enough for a loopback call on a busy machine, short enough that the one
 * request that pays it is not felt as a hang.
 */
export const FETCH_TIMEOUT_MS = 2_000;

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ApiRequestOptions {
  readonly method?: HttpMethod;
  /** Serialized as JSON; omit for a request without one. */
  readonly body?: unknown;
  /** Overrides {@link FETCH_TIMEOUT_MS}; the tests use it, the app does not. */
  readonly timeoutMs?: number;
  /** Caller-owned cancellation, e.g. TanStack Query aborting a stale query. */
  readonly signal?: AbortSignal;
}

/**
 * Which transport this window is using. It starts as `FETCH` and only ever moves
 * to `SHELL`, never back: once the WebView has proved it cannot reach loopback,
 * re-testing on every call would just pay the timeout again.
 */
let transport: Transport = 'FETCH';

export function apiTransport(): Transport {
  return transport;
}

/** Test seam: puts the transport back to its initial state. */
export function resetApiTransport(): void {
  transport = ApiTransport.parse('FETCH');
}

function requestHeaders(connection: Connection, hasBody: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    [CLIENT_SECRET_HEADER]: connection.clientSecret,
    Accept: 'application/json',
  };
  const token = authToken();
  if (token !== undefined) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (hasBody) {
    headers['Content-Type'] = 'application/json';
  }
  return headers;
}

/** Parses a body, tolerating an empty one (204) and a non-JSON one. */
async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === '') {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

async function viaFetch(
  connection: Connection,
  path: string,
  options: ApiRequestOptions,
): Promise<unknown> {
  const method = options.method ?? 'GET';
  const hasBody = options.body !== undefined;
  const timeout = AbortSignal.timeout(options.timeoutMs ?? FETCH_TIMEOUT_MS);
  const response = await fetch(`${connection.baseUrl}${path}`, {
    method,
    headers: requestHeaders(connection, hasBody),
    ...(hasBody ? { body: JSON.stringify(options.body) } : {}),
    signal: options.signal === undefined ? timeout : AbortSignal.any([timeout, options.signal]),
  });
  const body = await readBody(response);
  if (!response.ok) {
    throw problemFromBody(response.status, path, body);
  }
  return body;
}

async function viaShell(path: string, options: ApiRequestOptions): Promise<unknown> {
  const method = options.method ?? 'GET';
  const hasBody = options.body !== undefined;
  // Ruling R78: the fallback carries the app's own writes, with exactly the
  // headers the direct path sends minus the client secret, which the shell adds
  // from its own state rather than taking from the page.
  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = authToken();
  if (token !== undefined) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (hasBody) {
    headers['Content-Type'] = 'application/json';
  }
  const answer = await backendRequest({
    method,
    path,
    headers,
    ...(hasBody ? { body: JSON.stringify(options.body) } : {}),
  });
  let body: unknown;
  try {
    body = answer.body === '' ? undefined : JSON.parse(answer.body);
  } catch {
    body = undefined;
  }
  if (answer.status < 200 || answer.status >= 300) {
    throw problemFromBody(answer.status, path, body);
  }
  return body;
}

/**
 * Re-reads the connection after a transport failure (§3.2, ADR-0017).
 *
 * A higher `generation` means the backend crashed and was restarted with a fresh
 * client secret, so the request is worth exactly one more try. The same
 * generation means the secret was never the problem.
 */
async function newerConnection(previous: Connection): Promise<Connection | undefined> {
  try {
    const next = await backendConnection();
    return next.generation === previous.generation ? undefined : next;
  } catch {
    // There is no connection at all right now; the fallback is the last hope.
    return undefined;
  }
}

/**
 * One request against the loopback API.
 *
 * An HTTP status is a real answer and is never a reason to change transport — a
 * 401 or a 503 is the server speaking. Only a transport failure (a `TypeError`
 * from a CORS refusal or a dead socket, or the timeout above) triggers the
 * connection re-read and then, if that changes nothing, the shell fallback.
 */
export async function apiRequest(
  connection: Connection,
  path: string,
  options: ApiRequestOptions = {},
): Promise<unknown> {
  if (transport === 'SHELL') {
    return viaShell(path, options);
  }
  try {
    return await viaFetch(connection, path, options);
  } catch (cause) {
    if (cause instanceof ApiProblem) {
      throw cause;
    }
    if (options.signal?.aborted === true) {
      // The caller cancelled; this says nothing about the transport.
      throw unreachableProblem(path, cause);
    }
    const fresh = await newerConnection(connection);
    if (fresh !== undefined) {
      try {
        return await viaFetch(fresh, path, options);
      } catch (retryCause) {
        if (retryCause instanceof ApiProblem) {
          throw retryCause;
        }
      }
    }
    transport = 'SHELL';
    try {
      return await viaShell(path, options);
    } catch (fallbackCause) {
      if (fallbackCause instanceof ApiProblem) {
        throw fallbackCause;
      }
      throw unreachableProblem(path, fallbackCause);
    }
  }
}

/** Convenience for the common case. */
export async function apiGet(
  connection: Connection,
  path: string,
  options: Omit<ApiRequestOptions, 'method' | 'body'> = {},
): Promise<unknown> {
  return apiRequest(connection, path, { ...options, method: 'GET' });
}

/** `GET /api/v1/health` — the one call that needs no session (ADR-0017). */
export async function fetchHealth(
  connection: Connection,
  options: Omit<ApiRequestOptions, 'method' | 'body'> = {},
): Promise<Health> {
  return HealthResponse.parse(await apiGet(connection, '/api/v1/health', options));
}
