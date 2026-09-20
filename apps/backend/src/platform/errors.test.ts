import { ProblemDetails } from '@compintel/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { authedFetch, startTestServer, type TestServer } from '../testing/harness.js';
import { AppError, PROBLEM_CONTENT_TYPE, REQUEST_ID_HEADER } from './errors.js';

let server: TestServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

/** Adds the fixture routes the error paths need; the real app has none of these. */
async function startWithFixtures(): Promise<TestServer> {
  server = await startTestServer({
    extend: (app) => {
      app.server.get('/api/v1/boom', () => {
        throw new Error('database handle 0x1234 exploded at C:\\secret\\path');
      });
      app.server.get('/api/v1/teapot', () => {
        throw new AppError({
          code: 'CONFLICT',
          status: 409,
          title: 'Someone else changed this',
          detail: 'The event was edited while you were editing it.',
          hint: 'Reload and try again.',
          retryable: false,
        });
      });
      app.server.post(
        '/api/v1/echo',
        { schema: { body: z.object({ name: z.string().min(3), count: z.int() }) } },
        () => ({ ok: true }),
      );
    },
  });
  return server;
}

async function problemOf(response: Response): Promise<ProblemDetails> {
  return ProblemDetails.parse(await response.json());
}

describe('problem responses', () => {
  it('serves an AppError as problem+json with every member it carries', async () => {
    const test = await startWithFixtures();
    const response = await authedFetch(test, '/api/v1/teapot');

    expect(response.status).toBe(409);
    expect(response.headers.get('content-type')).toContain(PROBLEM_CONTENT_TYPE);

    const problem = await problemOf(response);
    expect(problem).toMatchObject({
      type: 'urn:compintel:problem:CONFLICT',
      title: 'Someone else changed this',
      status: 409,
      code: 'CONFLICT',
      detail: 'The event was edited while you were editing it.',
      hint: 'Reload and try again.',
      retryable: false,
      instance: '/api/v1/teapot',
    });
  });

  it('maps a schema failure to VALIDATION_FAILED with a path per field', async () => {
    const test = await startWithFixtures();
    const response = await authedFetch(test, '/api/v1/echo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'ab', count: 1.5 }),
    });

    expect(response.status).toBe(400);
    expect(response.headers.get('content-type')).toContain(PROBLEM_CONTENT_TYPE);

    const problem = await problemOf(response);
    expect(problem.code).toBe('VALIDATION_FAILED');
    expect(problem.errors?.map((error) => error.path).sort()).toStrictEqual([
      'body.count',
      'body.name',
    ]);
    for (const error of problem.errors ?? []) {
      expect(error.message.length).toBeGreaterThan(0);
    }
  });

  it('rejects a malformed JSON body as VALIDATION_FAILED, not as a 500', async () => {
    const test = await startWithFixtures();
    const response = await authedFetch(test, '/api/v1/echo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ not json',
    });

    expect(response.status).toBe(400);
    expect((await problemOf(response)).code).toBe('VALIDATION_FAILED');
  });

  it('answers an unknown route with NOT_FOUND', async () => {
    const test = await startWithFixtures();
    const response = await authedFetch(test, '/api/v1/no-such-thing');

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain(PROBLEM_CONTENT_TYPE);

    const problem = await problemOf(response);
    expect(problem.code).toBe('NOT_FOUND');
    expect(problem.type).toBe('urn:compintel:problem:NOT_FOUND');
    expect(problem.instance).toBe('/api/v1/no-such-thing');
  });

  it('hides everything about an unexpected throw', async () => {
    const test = await startWithFixtures();
    const response = await authedFetch(test, '/api/v1/boom');

    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).not.toContain('0x1234');
    expect(body).not.toContain('secret');
    expect(body).not.toContain('at Object');
    expect(body).not.toContain('.ts:');

    const problem = ProblemDetails.parse(JSON.parse(body));
    expect(problem.code).toBe('INTERNAL');
    expect(problem.title).toBe('Something went wrong');
    expect(problem.retryable).toBe(true);
    expect(Object.keys(problem)).not.toContain('stack');
  });
});

describe('X-Request-Id', () => {
  it('is on every response, success or failure', async () => {
    const test = await startWithFixtures();
    for (const path of ['/api/v1/health', '/api/v1/nope', '/api/v1/boom']) {
      const response = await authedFetch(test, path);
      expect(response.headers.get(REQUEST_ID_HEADER)).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    }
  });

  it('matches the requestId inside the problem body', async () => {
    const test = await startWithFixtures();
    const response = await authedFetch(test, '/api/v1/boom');
    const problem = await problemOf(response);
    expect(problem.requestId).toBe(response.headers.get(REQUEST_ID_HEADER));
  });

  it('is different for every request', async () => {
    const test = await startWithFixtures();
    const first = await authedFetch(test, '/api/v1/health');
    const second = await authedFetch(test, '/api/v1/health');
    expect(first.headers.get(REQUEST_ID_HEADER)).not.toBe(second.headers.get(REQUEST_ID_HEADER));
  });
});

describe('AppError', () => {
  it('omits every optional member that was not supplied', () => {
    const error = new AppError({ code: 'NOT_FOUND', status: 404, title: 'Not found' });
    expect(error.toProblemDetails('req-1')).toStrictEqual({
      type: 'urn:compintel:problem:NOT_FOUND',
      title: 'Not found',
      status: 404,
      code: 'NOT_FOUND',
      requestId: 'req-1',
    });
  });

  it('produces a body the contract accepts', () => {
    const error = new AppError({
      code: 'RATE_LIMITED',
      status: 429,
      title: 'Too many requests',
      detail: 'Try again in a minute.',
      retryable: true,
      errors: [{ path: 'query.limit', message: 'Too large' }],
    });
    expect(ProblemDetails.safeParse(error.toProblemDetails('req-2', '/x')).success).toBe(true);
  });

  it('keeps the cause for the logs without exposing it', () => {
    const cause = new Error('inner');
    const error = new AppError({ code: 'INTERNAL', status: 500, title: 'Boom', cause });
    expect(error.cause).toBe(cause);
    expect(JSON.stringify(error.toProblemDetails('req-3'))).not.toContain('inner');
  });
});
