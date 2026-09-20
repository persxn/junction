import { EnvHttpProxyAgent, interceptors, request, type Dispatcher } from 'undici';

import { asTransportError } from './classify.js';
import type { Fetcher, TransportRequest, TransportResponse } from './types.js';

/**
 * The one place in the codebase that opens a socket to somebody else's server.
 *
 * It is a plain function behind the `Fetcher` seam, so every test in
 * `pnpm verify` runs without it and nothing in the suite can reach the
 * internet by accident (R60).
 *
 * **TLS validation is never disabled** (§4.8, D-28, ADR-0007). There is no
 * option to turn it off, no `rejectUnauthorized`, no `NODE_TLS_*` handling, and
 * a test greps `src/**` to keep it that way. Eight of the 117 campus sites WP-02
 * surveyed have expired certificates; the answer to those is a `TLS` row in
 * Source status, not a workaround.
 *
 * **Proxy.** undici's `EnvHttpProxyAgent` reads `HTTP_PROXY`, `HTTPS_PROXY` and
 * `NO_PROXY` from the environment. It does **not** read WinINET — the Windows
 * "Internet Options" proxy the system browser uses is not visible to Node, and
 * nothing here tries to parse the registry for it. A pilot host behind a
 * configured-in-Windows proxy needs those variables set for the backend
 * process; §7.7's "the backend uses the Windows system proxy" is true only to
 * the extent that the environment carries it.
 */

/** Redirects are followed, but never off https and never more than three deep. */
const MAX_REDIRECTS = 3;

/** One dispatcher for the process; undici pools connections per origin. */
let shared: Dispatcher | undefined;

function dispatcher(): Dispatcher {
  shared ??= new EnvHttpProxyAgent({
    // Politeness is enforced above this layer, but a pool that can open six
    // sockets to one host makes that a promise rather than a property.
    connections: 1,
  }).compose(interceptors.redirect({ maxRedirections: MAX_REDIRECTS }));
  return shared;
}

function headersOf(raw: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (value === undefined) {
      continue;
    }
    out[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
  }
  return out;
}

export const undiciFetcher: Fetcher = async (req: TransportRequest): Promise<TransportResponse> => {
  try {
    const response = await request(req.url, {
      method: req.method,
      headers: { ...req.headers },
      signal: req.signal,
      dispatcher: dispatcher(),
      headersTimeout: req.connectTimeoutMs,
      bodyTimeout: req.totalTimeoutMs,
    });
    return {
      status: response.statusCode,
      headers: headersOf(response.headers),
      url: req.url,
      body: response.body,
    };
  } catch (error) {
    throw asTransportError(error);
  }
};

/** Closes the shared dispatcher; registered as a shutdown hook by `main.ts`. */
export async function closeTransport(): Promise<void> {
  const current = shared;
  shared = undefined;
  await current?.close();
}
