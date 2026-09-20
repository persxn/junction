import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { API_VERSION } from '@compintel/contracts';
import { pino } from 'pino';

import { buildApp, type App, type BuildAppOptions } from '../app.js';
import type { Config } from '../platform/config.js';
import { APP_VERSION } from '../platform/version.js';

/** Long enough to exercise the constant-time comparison honestly. */
export const TEST_CLIENT_SECRET = 'test-client-secret-0123456789abcdef';

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
}

/**
 * Boots the real application on a loopback port. Security depends on the Host
 * header matching the bound port, so these tests speak HTTP for real rather than
 * going through `inject`.
 */
export async function startTestServer(options: StartTestServerOptions = {}): Promise<TestServer> {
  const config = options.config ?? testConfig();
  const app = buildApp(config, pino({ enabled: false }), options);
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

/** `fetch` with the client secret attached, which is what the UI always does. */
export function authedFetch(
  server: TestServer,
  path_: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`${server.baseUrl}${path_}`, {
    ...init,
    headers: {
      'X-CompIntel-Client': server.config.clientSecret,
      ...(init.headers ?? {}),
    },
  });
}
