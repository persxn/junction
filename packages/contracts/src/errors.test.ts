import { describe, expect, it } from 'vitest';

import {
  ERROR_CODES,
  ErrorCode,
  PROBLEM_TYPE_PREFIX,
  ProblemDetails,
  ProblemFieldError,
  problemType,
} from './errors.js';

const valid = {
  type: 'urn:compintel:problem:SOURCE_UNREACHABLE',
  title: 'The source could not be reached',
  status: 503,
  code: 'SOURCE_UNREACHABLE',
  requestId: '01931f2a-0000-7000-8000-000000000000',
  detail: 'ctftime.org did not respond within 10000 ms.',
  instance: '/api/v1/sources/ctftime/runs/1',
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

describe('problemType', () => {
  it('builds a URN the schema accepts for every code', () => {
    for (const code of ERROR_CODES) {
      const type = problemType(code);
      expect(type).toBe(`${PROBLEM_TYPE_PREFIX}${code}`);
      expect(ProblemDetails.safeParse({ ...valid, type, code }).success).toBe(true);
    }
  });
});

describe('ProblemFieldError', () => {
  it('accepts a path and a message', () => {
    expect(
      ProblemFieldError.parse({ path: 'body.port', message: 'Expected number' }),
    ).toStrictEqual({ path: 'body.port', message: 'Expected number' });
  });

  it('accepts an empty path for a whole-body complaint', () => {
    expect(ProblemFieldError.safeParse({ path: '', message: 'Expected object' }).success).toBe(
      true,
    );
  });

  it('rejects an empty message', () => {
    expect(ProblemFieldError.safeParse({ path: 'body', message: '' }).success).toBe(false);
  });
});

describe('ProblemDetails', () => {
  it('accepts a fully populated problem', () => {
    expect(ProblemDetails.parse(valid)).toStrictEqual(valid);
  });

  it('accepts the five required members on their own (R5)', () => {
    const minimal = {
      type: 'urn:compintel:problem:INTERNAL',
      title: 'Something went wrong',
      status: 500,
      code: 'INTERNAL',
      requestId: 'abc',
    };
    expect(ProblemDetails.parse(minimal)).toStrictEqual(minimal);
  });

  it.each(['type', 'title', 'status', 'code', 'requestId'] as const)(
    'rejects a problem missing the required member %s',
    (field) => {
      const { [field]: _omitted, ...rest } = valid;
      expect(ProblemDetails.safeParse(rest).success).toBe(false);
    },
  );

  it.each(['detail', 'instance', 'hint', 'retryable'] as const)(
    'treats %s as optional',
    (field) => {
      const { [field]: _omitted, ...rest } = valid;
      expect(ProblemDetails.safeParse(rest).success).toBe(true);
    },
  );

  it('carries field errors for a validation failure', () => {
    const problem = {
      type: 'urn:compintel:problem:VALIDATION_FAILED',
      title: 'The request is not valid',
      status: 400,
      code: 'VALIDATION_FAILED',
      requestId: 'abc',
      errors: [{ path: 'body.name', message: 'Required' }],
    };
    expect(ProblemDetails.parse(problem)).toStrictEqual(problem);
  });

  it('rejects a malformed field error', () => {
    const result = ProblemDetails.safeParse({ ...valid, errors: [{ path: 'body' }] });
    expect(result.success).toBe(false);
  });

  it.each(['about:blank', 'https://example.com/problems/x', 'urn:other:problem:X', 'not a uri'])(
    'rejects the type %p — only the CompIntel URN is allowed',
    (type) => {
      expect(ProblemDetails.safeParse({ ...valid, type }).success).toBe(false);
    },
  );

  it('rejects an empty title', () => {
    expect(ProblemDetails.safeParse({ ...valid, title: '' }).success).toBe(false);
  });

  it('rejects an empty requestId', () => {
    expect(ProblemDetails.safeParse({ ...valid, requestId: '' }).success).toBe(false);
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
