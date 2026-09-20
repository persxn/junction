import { z } from 'zod';

/**
 * Canonical enum lists (ARCHITECTURE.md §6.1: "the canonical enum lists live in
 * `packages/contracts`"). Values are copied verbatim from the §6.2 table rows and §6.4;
 * the SQLite CHECK constraints in the migrations must match these exactly.
 */

/** `events.event_type` (§6.2 Events). */
export const EVENT_TYPES = [
  'HACKATHON',
  'IDEATHON',
  'INNOVATION_CHALLENGE',
  'CTF',
  'CODING_CONTEST',
  'OTHER',
] as const;
export const EventType = z.enum(EVENT_TYPES);
export type EventType = z.infer<typeof EventType>;

/** `events.mode` (§6.2 Events, "Format & place"). */
export const EVENT_MODES = ['ONLINE', 'OFFLINE', 'HYBRID', 'UNKNOWN'] as const;
export const EventMode = z.enum(EVENT_MODES);
export type EventMode = z.infer<typeof EventMode>;

/**
 * Registration state — derived, never stored (§6.4): computed from the registration
 * dates and the current time. CLOSING_SOON means the deadline is 7 days away or less.
 */
export const REG_STATES = ['NOT_OPEN', 'OPEN', 'CLOSING_SOON', 'CLOSED', 'UNKNOWN'] as const;
export const RegState = z.enum(REG_STATES);
export type RegState = z.infer<typeof RegState>;

/** `sources.compliance_status` (§6.2 Sources & ingestion; the WP-02 verdicts use these). */
export const COMPLIANCE_STATUSES = [
  'APPROVED',
  'APPROVED_WITH_LIMITS',
  'MANUAL_IMPORT_ONLY',
  'PENDING_REVIEW',
  'BLOCKED',
] as const;
export const ComplianceStatus = z.enum(COMPLIANCE_STATUSES);
export type ComplianceStatus = z.infer<typeof ComplianceStatus>;

/** `scrape_runs.error_kind` (§6.2 Sources & ingestion). */
export const SCRAPE_ERROR_KINDS = [
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
] as const;
export const ScrapeErrorKind = z.enum(SCRAPE_ERROR_KINDS);
export type ScrapeErrorKind = z.infer<typeof ScrapeErrorKind>;
