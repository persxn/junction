import { describe, expect, it } from 'vitest';

import { ApiProblem } from './problem.js';
import { createQueryClient, queryKeys, shouldRetry } from './query.js';

function problem(status: number, retryable?: boolean): ApiProblem {
  return new ApiProblem({
    status,
    code: status === 409 ? 'CONFLICT' : 'INTERNAL',
    title: 'test',
    path: '/api/v1/test',
    ...(retryable === undefined ? {} : { retryable }),
  });
}

describe('the retry policy', () => {
  it.each([400, 401, 403, 404, 422, 409])('does not retry a %d', (status) => {
    // A 409 in particular: retrying would re-submit a write made against a
    // stale version (§4.4), so it has to reach the caller.
    expect(shouldRetry(0, problem(status))).toBe(false);
  });

  it.each([500, 502, 503, 429, 408])('retries a %d, twice at most', (status) => {
    expect(shouldRetry(0, problem(status))).toBe(true);
    expect(shouldRetry(1, problem(status))).toBe(true);
    expect(shouldRetry(2, problem(status))).toBe(false);
  });

  it('retries a request that never reached the backend', () => {
    expect(shouldRetry(0, problem(0))).toBe(true);
  });

  it('obeys the backend when it says a failure is not worth retrying', () => {
    expect(shouldRetry(0, problem(503, false))).toBe(false);
  });

  it('never retries something that is not an ApiProblem, because that is a bug', () => {
    expect(shouldRetry(0, new Error('undefined is not a function'))).toBe(false);
    expect(shouldRetry(0, undefined)).toBe(false);
  });
});

describe('the query client', () => {
  it('uses the shared defaults', () => {
    const defaults = createQueryClient().getDefaultOptions();
    expect(defaults.queries?.staleTime).toBe(30_000);
    expect(defaults.queries?.refetchOnWindowFocus).toBe(false);
    // A write is never replayed automatically.
    expect(defaults.mutations?.retry).toBe(false);
  });
});

describe('the query-key convention', () => {
  it('starts every key with its domain', () => {
    expect(queryKeys.health()).toStrictEqual(['health']);
  });
});
