import { describe, expect, it } from 'vitest';

import {
  AUTH_ERROR_CODES,
  CATEGORY_ERROR_CODES,
  COMMON_ERROR_CODES,
  DB_ERROR_CODES,
  ERROR_CODE_DOMAINS,
  ERROR_CODES,
  ErrorCode,
  EVENT_ERROR_CODES,
  GEO_ERROR_CODES,
  IMPORT_ERROR_CODES,
  PROBLEM_TYPE_PREFIX,
  ProblemDetails,
  ProblemFieldError,
  SEARCH_ERROR_CODES,
  STUDENT_ERROR_CODES,
  TEAM_ERROR_CODES,
  ENGAGEMENT_ERROR_CODES,
  WORKFLOW_ERROR_CODES,
  RESOURCE_ERROR_CODES,
  SETUP_ERROR_CODES,
  SOURCE_ERROR_CODES,
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
      'AUTH_INVALID_CREDENTIALS',
      'AUTH_ACCOUNT_LOCKED',
      'AUTH_ACCOUNT_DISABLED',
      'AUTH_SESSION_EXPIRED',
      'AUTH_PASSWORD_CHANGE_REQUIRED',
      'AUTH_RECOVERY_INVALID',
      'SETUP_REQUIRED',
      'SETUP_ALREADY_DONE',
      'SETUP_PATH_UNUSABLE',
      'SETUP_PASSPHRASE_WEAK',
      'SOURCE_NOT_FOUND',
      'SOURCE_UNREACHABLE',
      'SOURCE_BLOCKED_BY_POLICY',
      'SOURCE_ROBOTS_DISALLOWED',
      'SOURCE_RATE_LIMITED',
      'SOURCE_SCHEMA_CHANGED',
      'SOURCE_PARSE_FAILED',
      'SOURCE_REFRESH_TOO_SOON',
      'SOURCE_SETUP_INCOMPLETE',
      'SOURCE_HOST_FORBIDDEN',
      'SOURCE_PATH_FORBIDDEN',
      'EVENT_NOT_FOUND',
      'EVENT_INVALID_CANDIDATE',
      'EVENT_VERSION_CONFLICT',
      'EVENT_ALREADY_MERGED',
      'EVENT_MERGE_CONFLICT',
      'EVENT_NOT_MERGED',
      'EVENT_INVALID_DATES',
      'EVENT_OVERRIDE_INVALID',
      'EVENT_MERGE_SELF',
      'EVENT_CANDIDATE_DECIDED',
      'GEO_GAZETTEER_UNAVAILABLE',
      'GEO_PLACE_UNKNOWN',
      'GEO_COORDINATES_INVALID',
      'GEO_POLICY_INVALID',
      'SEARCH_INVALID_QUERY',
      'SEARCH_INDEX_UNAVAILABLE',
      'SEARCH_TOO_BROAD',
      'SEARCH_SAVED_NOT_FOUND',
      'SEARCH_INVALID_CURSOR',
      'SEARCH_TEXT_TOO_LONG',
      'SEARCH_ALIAS_EXISTS',
      'SEARCH_INVALID_RULE',
      'SEARCH_RULE_PATTERN_UNSAFE',
      'CATEGORY_IN_USE',
      'IMPORT_FILE_UNREADABLE',
      'IMPORT_FORMAT_UNSUPPORTED',
      'IMPORT_SOURCE_NOT_ALLOWED',
      'IMPORT_ROW_INVALID',
      'IMPORT_TOO_LARGE',
      'IMPORT_URL_INVALID',
      'IMPORT_DOMAIN_MANUAL_ONLY',
      'IMPORT_ROBOTS_DISALLOWED',
      'IMPORT_EXTRACTION_FAILED',
      'IMPORT_UNSUPPORTED_CONTENT',
      'IMPORT_RATE_LIMITED',
      'STUDENT_NOT_FOUND',
      'STUDENT_UNIVERSITY_ID_TAKEN',
      'STUDENT_PHONE_DISABLED',
      'STUDENT_EXTERNAL_DISABLED',
      'STUDENT_ERASED',
      'STUDENT_VERSION_CONFLICT',
      'STUDENT_ALREADY_MENTORED',
      'STUDENT_MENTORSHIP_NOT_FOUND',
      'STUDENT_IMPORT_PREVIEW_EXPIRED',
      'STUDENT_IMPORT_FILE_INVALID',
      'STUDENT_IMPORT_TOO_LARGE',
      'TEAM_NOT_FOUND',
      'TEAM_NAME_TAKEN',
      'TEAM_ARCHIVED',
      'TEAM_VERSION_CONFLICT',
      'TEAM_MEMBER_EXISTS',
      'TEAM_MEMBER_NOT_FOUND',
      'TEAM_STUDENT_NOT_ACTIVE',
      'TEAM_MENTOR_NOT_PROFESSOR',
      'TEAM_MENTOR_EXISTS',
      'TEAM_MENTOR_NOT_FOUND',
      'TEAM_LEAD_NOT_MEMBER',
      'TEAM_HAS_ACTIVE_COMPETITIONS',
      'ENGAGEMENT_NOT_FOUND',
      'ENGAGEMENT_INVALID_TRANSITION',
      'ENGAGEMENT_STUDENT_ALREADY_ACTIVE',
      'ENGAGEMENT_TEAM_ALREADY_ASSIGNED',
      'ENGAGEMENT_EVENT_MERGED',
      'ENGAGEMENT_CLOSED',
      'ENGAGEMENT_EMPTY_ROSTER',
      'ENGAGEMENT_MENTOR_EXISTS',
      'ENGAGEMENT_MENTOR_NOT_FOUND',
      'ENGAGEMENT_PARTICIPANT_NOT_FOUND',
      'ENGAGEMENT_VERSION_CONFLICT',
      'WORKFLOW_NOT_FOUND',
      'WORKFLOW_STAGE_NOT_FOUND',
      'WORKFLOW_TASK_NOT_FOUND',
      'WORKFLOW_TEMPLATE_NOT_FOUND',
      'WORKFLOW_VERSION_CONFLICT',
      'WORKFLOW_OPEN_TASKS',
      'WORKFLOW_BLOCKED_REASON_REQUIRED',
      'WORKFLOW_TEMPLATE_READ_ONLY',
      'WORKFLOW_ASSIGNEE_NOT_ON_ROSTER',
      'RESOURCE_NOT_FOUND',
      'RESOURCE_INVALID_URI',
      'RESOURCE_OWNER_NOT_FOUND',
      'RESOURCE_VERSION_CONFLICT',
      'DB_UNAVAILABLE',
      'DB_CONSTRAINT_VIOLATED',
    ]);
  });

  it('is the concatenation of the per-domain lists (R12)', () => {
    expect([...ERROR_CODES]).toStrictEqual([
      ...COMMON_ERROR_CODES,
      ...AUTH_ERROR_CODES,
      ...SETUP_ERROR_CODES,
      ...SOURCE_ERROR_CODES,
      ...EVENT_ERROR_CODES,
      ...GEO_ERROR_CODES,
      ...SEARCH_ERROR_CODES,
      ...CATEGORY_ERROR_CODES,
      ...IMPORT_ERROR_CODES,
      ...STUDENT_ERROR_CODES,
      ...TEAM_ERROR_CODES,
      ...ENGAGEMENT_ERROR_CODES,
      ...WORKFLOW_ERROR_CODES,
      ...RESOURCE_ERROR_CODES,
      ...DB_ERROR_CODES,
    ]);
  });

  it('has no duplicates across domains', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
  });

  it.each([
    ['AUTH_', AUTH_ERROR_CODES],
    ['SETUP_', SETUP_ERROR_CODES],
    ['SOURCE_', SOURCE_ERROR_CODES],
    ['STUDENT_', STUDENT_ERROR_CODES],
    ['TEAM_', TEAM_ERROR_CODES],
    ['ENGAGEMENT_', ENGAGEMENT_ERROR_CODES],
    ['WORKFLOW_', WORKFLOW_ERROR_CODES],
    ['RESOURCE_', RESOURCE_ERROR_CODES],
    ['DB_', DB_ERROR_CODES],
  ])('prefixes every %s domain code', (prefix, codes) => {
    for (const code of codes) {
      expect(code.startsWith(prefix)).toBe(true);
    }
  });

  it('keeps the common codes unprefixed', () => {
    for (const code of COMMON_ERROR_CODES) {
      expect(code).not.toMatch(/^[A-Z]+_[A-Z]+_/);
    }
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

describe('the error-code domains (ruling R12)', () => {
  it('gives every non-common code a registered domain prefix', () => {
    const common = new Set<string>(COMMON_ERROR_CODES);
    for (const code of ERROR_CODES) {
      if (common.has(code)) {
        continue;
      }
      const domain = code.slice(0, code.indexOf('_'));
      expect(ERROR_CODE_DOMAINS, code).toContain(domain);
    }
  });

  it('uses SCREAMING_SNAKE throughout', () => {
    for (const code of ERROR_CODES) {
      expect(code, code).toMatch(/^[A-Z]+(_[A-Z0-9]+)*$/);
    }
  });

  it('gives every non-common code a DOMAIN_NAME shape', () => {
    const common = new Set<string>(COMMON_ERROR_CODES);
    for (const code of ERROR_CODES) {
      if (!common.has(code)) {
        expect(code, code).toMatch(/^[A-Z]+_[A-Z0-9_]+$/);
      }
    }
  });

  it('has no duplicates across the whole enum', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
  });

  it('declares no domain that nothing uses', () => {
    const used = new Set(
      ERROR_CODES.filter((code) => !new Set<string>(COMMON_ERROR_CODES).has(code)).map((code) =>
        code.slice(0, code.indexOf('_')),
      ),
    );
    expect([...ERROR_CODE_DOMAINS].sort()).toStrictEqual([...used].sort());
  });

  it('carries the blocks M1 needs', () => {
    expect(ERROR_CODES).toContain('EVENT_VERSION_CONFLICT');
    expect(ERROR_CODES).toContain('GEO_PLACE_UNKNOWN');
    expect(ERROR_CODES).toContain('SEARCH_INVALID_QUERY');
    expect(ERROR_CODES).toContain('IMPORT_SOURCE_NOT_ALLOWED');
    expect(ERROR_CODES).toContain('SOURCE_ROBOTS_DISALLOWED');
  });

  it('still builds a problem type URN for every one of them', () => {
    for (const code of ERROR_CODES) {
      expect(problemType(code)).toBe(`${PROBLEM_TYPE_PREFIX}${code}`);
      expect(ProblemDetails.shape.type.safeParse(problemType(code)).success, code).toBe(true);
    }
  });
});
