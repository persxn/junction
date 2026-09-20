import { ProblemDetails } from '@compintel/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  rawRequest,
  startTestServer,
  TEST_CLIENT_SECRET,
  type TestServer,
} from '../testing/harness.js';
import { ALLOWED_HEADERS, ALLOWED_ORIGINS, secretMatches } from './security.js';

let server: TestServer;

beforeEach(async () => {
  server = await startTestServer();
});

afterEach(async () => {
  await server.close();
});

const health = (): string => `${server.baseUrl}/api/v1/health`;

describe('client secret', () => {
  it('lets a request with the right secret through', async () => {
    const response = await fetch(health(), {
      headers: { 'X-CompIntel-Client': TEST_CLIENT_SECRET },
    });
    expect(response.status).toBe(200);
  });

  it('answers 401 when the header is missing', async () => {
    const response = await fetch(health());
    expect(response.status).toBe(401);
    expect(ProblemDetails.parse(await response.json()).code).toBe('UNAUTHORIZED');
  });

  it.each([
    ['a wrong secret of the same length', 'x'.repeat(TEST_CLIENT_SECRET.length)],
    ['a shorter secret', TEST_CLIENT_SECRET.slice(0, -1)],
    ['a longer secret', `${TEST_CLIENT_SECRET}x`],
    ['an empty secret', ''],
  ])('answers 401 for %s', async (_label, secret) => {
    const response = await fetch(health(), { headers: { 'X-CompIntel-Client': secret } });
    expect(response.status).toBe(401);
    expect(ProblemDetails.parse(await response.json()).code).toBe('UNAUTHORIZED');
  });

  it('does not accept the secret in the query string', async () => {
    const response = await fetch(`${health()}?clientSecret=${TEST_CLIENT_SECRET}`);
    expect(response.status).toBe(401);
  });
});

describe('secretMatches', () => {
  it('accepts only an exact match', () => {
    expect(secretMatches('abc', 'abc')).toBe(true);
    expect(secretMatches('abd', 'abc')).toBe(false);
    expect(secretMatches('ab', 'abc')).toBe(false);
    expect(secretMatches('abcd', 'abc')).toBe(false);
    expect(secretMatches(undefined, 'abc')).toBe(false);
  });
});

describe('Host allowlist', () => {
  it.each(['evil.example', 'compintel.test:1234', '127.0.0.1:1', 'localhost'])(
    'answers 403 for the Host %p',
    async (host) => {
      const response = await rawRequest(server, {
        path: '/api/v1/health',
        headers: { 'X-CompIntel-Client': TEST_CLIENT_SECRET, Host: host },
      });
      expect(response.status).toBe(403);
      expect(ProblemDetails.parse(JSON.parse(response.body)).code).toBe('FORBIDDEN');
    },
  );

  it.each(['127.0.0.1', 'localhost'])('accepts the Host spelling %s', async (name) => {
    const port = new URL(server.baseUrl).port;
    const response = await rawRequest(server, {
      path: '/api/v1/health',
      headers: { 'X-CompIntel-Client': TEST_CLIENT_SECRET, Host: `${name}:${port}` },
    });
    expect(response.status).toBe(200);
  });

  it('is checked before the client secret, so a rebind attempt cannot probe it', async () => {
    const response = await rawRequest(server, {
      path: '/api/v1/health',
      headers: { Host: 'evil.example' },
    });
    expect(response.status).toBe(403);
  });
});

describe('CORS', () => {
  it.each(ALLOWED_ORIGINS)('answers a preflight from %s without the secret', async (origin) => {
    const response = await fetch(health(), {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'x-compintel-client',
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe(origin);
    expect(response.headers.get('access-control-allow-methods')).toContain('GET');
    for (const header of ALLOWED_HEADERS) {
      expect(response.headers.get('access-control-allow-headers')).toContain(header);
    }
  });

  it('still demands the secret for a preflight from an unknown origin', async () => {
    const response = await fetch(health(), {
      method: 'OPTIONS',
      headers: { Origin: 'http://evil.example', 'Access-Control-Request-Method': 'GET' },
    });
    expect(response.status).toBe(401);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('sends no CORS headers to a non-allowlisted origin on a real request', async () => {
    const response = await fetch(health(), {
      headers: { 'X-CompIntel-Client': TEST_CLIENT_SECRET, Origin: 'http://evil.example' },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('sends the allow-origin header to an allowlisted origin on a real request', async () => {
    const response = await fetch(health(), {
      headers: { 'X-CompIntel-Client': TEST_CLIENT_SECRET, Origin: ALLOWED_ORIGINS[0] },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe(ALLOWED_ORIGINS[0]);
  });

  it('does not exempt a bare OPTIONS request that is not a preflight', async () => {
    const response = await fetch(health(), {
      method: 'OPTIONS',
      headers: { Origin: ALLOWED_ORIGINS[0] },
    });
    expect(response.status).toBe(401);
  });

  it('exposes the request id to the browser', async () => {
    const response = await fetch(health(), {
      method: 'OPTIONS',
      headers: { Origin: ALLOWED_ORIGINS[0], 'Access-Control-Request-Method': 'GET' },
    });
    expect(response.headers.get('access-control-expose-headers')).toContain('X-Request-Id');
  });
});
