import { ProblemDetails } from '@compintel/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  authedFetch,
  capturingLogger,
  startTestServer,
  type TestServer,
} from '../testing/harness.js';
import { pathOf } from './request-log.js';

let server: TestServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

interface LogLine {
  level: number;
  msg: string;
  method?: string;
  route?: string;
  status?: number;
  ms?: number;
  requestId?: string;
}

async function startWithLog(): Promise<{ test: TestServer; lines: () => LogLine[] }> {
  const captured = capturingLogger('debug');
  server = await startTestServer({
    logger: captured.logger,
    extend: (app) => {
      app.server.get(
        '/api/v1/things/:id',
        { schema: { params: z.object({ id: z.string() }) } },
        () => ({ ok: true }),
      );
    },
  });
  return { test: server, lines: () => captured.lines() as LogLine[] };
}

const requestLines = (lines: LogLine[]): LogLine[] =>
  lines.filter((line) => line.msg === 'request');

describe('pathOf', () => {
  it.each([
    ['/api/v1/health', '/api/v1/health'],
    ['/api/v1/events?q=hack&limit=20', '/api/v1/events'],
    ['/api/v1/events?', '/api/v1/events'],
    ['/', '/'],
  ])('strips the query string from %p', (url, expected) => {
    expect(pathOf(url)).toBe(expected);
  });
});

describe('request logging (R11)', () => {
  it('writes exactly one line per request', async () => {
    const { test, lines } = await startWithLog();
    await authedFetch(test, '/api/v1/things/42');
    await authedFetch(test, '/api/v1/things/43');
    expect(requestLines(lines())).toHaveLength(2);
  });

  it('carries method, route, status, ms and requestId', async () => {
    const { test, lines } = await startWithLog();
    const response = await authedFetch(test, '/api/v1/things/42');

    const line = requestLines(lines())[0];
    expect(line).toMatchObject({
      method: 'GET',
      route: '/api/v1/things/:id',
      status: 200,
      requestId: response.headers.get('x-request-id'),
    });
    expect(typeof line?.ms).toBe('number');
    expect(line?.ms).toBeGreaterThanOrEqual(0);
  });

  it('logs the route pattern, not the concrete id', async () => {
    const { test, lines } = await startWithLog();
    await authedFetch(test, '/api/v1/things/secret-looking-id');
    expect(requestLines(lines())[0]?.route).toBe('/api/v1/things/:id');
  });

  it('logs the path without the query string for an unmatched route', async () => {
    const { test, lines } = await startWithLog();
    await authedFetch(test, '/api/v1/nope?token=should-not-be-logged');

    const line = requestLines(lines())[0];
    expect(line?.route).toBe('/api/v1/nope');
    expect(line?.status).toBe(404);
    expect(JSON.stringify(lines())).not.toContain('should-not-be-logged');
  });

  it('keeps GET /health at debug so the shell poll does not flood the file', async () => {
    const { test, lines } = await startWithLog();
    await authedFetch(test, '/api/v1/health');

    const line = requestLines(lines())[0];
    expect(line?.route).toBe('/api/v1/health');
    expect(line?.level).toBe(20);
  });

  it('logs other routes at info', async () => {
    const { test, lines } = await startWithLog();
    await authedFetch(test, '/api/v1/things/42');
    expect(requestLines(lines())[0]?.level).toBe(30);
  });

  it('still logs a rejected request, with the status the client saw', async () => {
    const { test, lines } = await startWithLog();
    const response = await fetch(`${test.baseUrl}/api/v1/things/42`);
    expect(response.status).toBe(401);

    const line = requestLines(lines())[0];
    expect(line?.status).toBe(401);
    expect(line?.requestId).toBe(response.headers.get('x-request-id'));
  });
});

describe('ProblemDetails.instance (R13)', () => {
  it('is the path, never the query string', async () => {
    const { test } = await startWithLog();
    const response = await authedFetch(test, '/api/v1/missing?q=hackathon&token=abc123');
    expect(response.status).toBe(404);

    const problem = ProblemDetails.parse(await response.json());
    expect(problem.instance).toBe('/api/v1/missing');
    expect(JSON.stringify(problem)).not.toContain('abc123');
    expect(JSON.stringify(problem)).not.toContain('hackathon');
  });
});
