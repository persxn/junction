import { describe, expect, it } from 'vitest';

import {
  COMPLIANCE_STATUSES,
  ComplianceStatus,
  EVENT_MODES,
  EVENT_TYPES,
  EventMode,
  EventType,
  REG_STATES,
  RegState,
  SCRAPE_ERROR_KINDS,
  ScrapeErrorKind,
} from './enums.js';

const cases = [
  { name: 'EventType', schema: EventType, values: EVENT_TYPES },
  { name: 'EventMode', schema: EventMode, values: EVENT_MODES },
  { name: 'RegState', schema: RegState, values: REG_STATES },
  { name: 'ComplianceStatus', schema: ComplianceStatus, values: COMPLIANCE_STATUSES },
  { name: 'ScrapeErrorKind', schema: ScrapeErrorKind, values: SCRAPE_ERROR_KINDS },
] as const;

describe.each(cases)('$name', ({ schema, values }) => {
  it('accepts every canonical value', () => {
    for (const value of values) {
      expect(schema.parse(value)).toBe(value);
    }
  });

  it('rejects an unknown value', () => {
    expect(schema.safeParse('NOT_A_REAL_VALUE').success).toBe(false);
  });

  it('rejects a lowercase variant', () => {
    expect(schema.safeParse(values[0].toLowerCase()).success).toBe(false);
  });

  it('rejects a non-string', () => {
    expect(schema.safeParse(1).success).toBe(false);
    expect(schema.safeParse(null).success).toBe(false);
    expect(schema.safeParse(undefined).success).toBe(false);
  });

  it('has no duplicate values', () => {
    expect(new Set(values).size).toBe(values.length);
  });
});

describe('enum contents', () => {
  it('matches ARCHITECTURE.md §6.2 events.event_type', () => {
    expect([...EVENT_TYPES]).toStrictEqual([
      'HACKATHON',
      'IDEATHON',
      'INNOVATION_CHALLENGE',
      'CTF',
      'CODING_CONTEST',
      'OTHER',
    ]);
  });

  it('matches ARCHITECTURE.md §6.2 events.mode', () => {
    expect([...EVENT_MODES]).toStrictEqual(['ONLINE', 'OFFLINE', 'HYBRID', 'UNKNOWN']);
  });

  it('matches ARCHITECTURE.md §6.4 registration state', () => {
    expect([...REG_STATES]).toStrictEqual([
      'NOT_OPEN',
      'OPEN',
      'CLOSING_SOON',
      'CLOSED',
      'UNKNOWN',
    ]);
  });

  it('matches ARCHITECTURE.md §6.2 sources.compliance_status', () => {
    expect([...COMPLIANCE_STATUSES]).toStrictEqual([
      'APPROVED',
      'APPROVED_WITH_LIMITS',
      'MANUAL_IMPORT_ONLY',
      'PENDING_REVIEW',
      'BLOCKED',
    ]);
  });

  it('matches ARCHITECTURE.md §6.2 scrape_runs.error_kind', () => {
    expect([...SCRAPE_ERROR_KINDS]).toStrictEqual([
      'NETWORK',
      'DNS',
      'TLS',
      'TIMEOUT',
      'HTTP_4XX',
      'HTTP_5XX',
      'BLOCKED',
      'RATE_LIMITED',
      'ROBOTS_DISALLOWED',
      'PARSE',
      'SCHEMA_CHANGED',
      'UNKNOWN',
    ]);
  });
});
