import { describe, expect, it } from 'vitest';

import { ERROR_CODES, ErrorCode, ProblemDetails } from './errors.js';

const valid = {
  type: 'https://compintel.local/problems/source-unreachable',
  title: 'The source could not be reached',
  status: 503,
  detail: 'ctftime.org did not respond within 10000 ms.',
  instance: '/api/v1/sources/ctftime/runs/01931f2a-0000-7000-8000-000000000000',
  code: 'SOURCE_UNREACHABLE',
  hint: 'Check the network connection, then run the source again.',
  retryable: true,
} as const;

describe('ErrorCode', () => {
  it('accepts every canonical code', () => {
    for (const code of ERROR_CODES) {
      expect(ErrorCode.parse(code)).toBe(code);
    }
  });

  it('rejects an unknown code', () => {
    expect(ErrorCode.safeParse('TEAPOT').success).toBe(false);
  });

  it('holds exactly the codes the spec lists', () => {
    expect([...ERROR_CODES]).toStrictEqual([
      'INTERNAL',
      'VALIDATION_FAILED',
      'UNAUTHORIZED',
      'FORBIDDEN',
      'NOT_FOUND',
      'CONFLICT',
      'RATE_LIMITED',
      'SOURCE_UNREACHABLE',
    ]);
  });
});

describe('ProblemDetails', () => {
  it('accepts a fully populated problem', () => {
    expect(ProblemDetails.parse(valid)).toStrictEqual(valid);
  });

  it('accepts about:blank as the type', () => {
    const result = ProblemDetails.safeParse({ ...valid, type: 'about:blank' });
    expect(result.success).toBe(true);
  });

  it('treats hint and retryable as optional', () => {
    const { hint: _hint, retryable: _retryable, ...rest } = valid;
    expect(ProblemDetails.safeParse(rest).success).toBe(true);
  });

  it.each(['type', 'title', 'status', 'detail', 'instance', 'code'] as const)(
    'rejects a problem missing %s',
    (field) => {
      const { [field]: _omitted, ...rest } = valid;
      expect(ProblemDetails.safeParse(rest).success).toBe(false);
    },
  );

  it('rejects a type that is not a URI', () => {
    expect(ProblemDetails.safeParse({ ...valid, type: 'not a uri' }).success).toBe(false);
  });

  it('rejects an empty title', () => {
    expect(ProblemDetails.safeParse({ ...valid, title: '' }).success).toBe(false);
  });

  it.each([99, 600, 503.5, '503'])('rejects the status %p', (status) => {
    expect(ProblemDetails.safeParse({ ...valid, status }).success).toBe(false);
  });

  it('rejects an unknown code', () => {
    expect(ProblemDetails.safeParse({ ...valid, code: 'BOOM' }).success).toBe(false);
  });

  it('rejects a non-boolean retryable', () => {
    expect(ProblemDetails.safeParse({ ...valid, retryable: 'yes' }).success).toBe(false);
  });

  it('reports the offending path so the backend can log it', () => {
    const result = ProblemDetails.safeParse({ ...valid, status: 42 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toStrictEqual(['status']);
    }
  });
});
