import { z } from 'zod';

import { Uuid7 } from './ids.js';
import { Resource, ResourceKind, RESOURCE_LABEL_MAX, RESOURCE_URI_MAX } from './resources.js';

/**
 * A competition's outcome (§6.2 `engagement_outcomes`, Q7, D-21, ruling R104,
 * WP-21): one per competition, recorded once it has happened. The result is
 * the team's. A prize amount keeps its own currency and is never converted or
 * summed across currencies (R63).
 */

export const OUTCOME_RESULTS = [
  'PARTICIPATED',
  'DID_NOT_PARTICIPATE',
  'QUALIFIED',
  'FINALIST',
  'RUNNER_UP',
  'WINNER',
  'OTHER',
] as const;
export const OutcomeResult = z.enum(OUTCOME_RESULTS);
export type OutcomeResult = z.infer<typeof OutcomeResult>;

export const OUTCOME_RESULT_LABELS: Readonly<Record<OutcomeResult, string>> = {
  PARTICIPATED: 'Participated',
  DID_NOT_PARTICIPATE: 'Did not participate',
  QUALIFIED: 'Qualified',
  FINALIST: 'Finalist',
  RUNNER_UP: 'Runner-up',
  WINNER: 'Winner',
  OTHER: 'Other result',
};

export const OUTCOME_TEXT_MAX = 2000;
export const PRIZE_TEXT_MAX = 200;

/** The certificate, added in the same form: an existing resource, or a new one. */
export const CertificateInput = z.union([
  z.object({ resourceId: Uuid7 }).strict(),
  z
    .object({
      uri: z.string().trim().min(1).max(RESOURCE_URI_MAX),
      kind: ResourceKind.optional(),
      label: z.string().trim().min(1).max(RESOURCE_LABEL_MAX).optional(),
      machineLabel: z.string().trim().min(1).max(64).optional(),
    })
    .strict(),
]);
export type CertificateInput = z.infer<typeof CertificateInput>;

/**
 * `PUT /competitions/:id/outcome`. Shape only: R104's cross-field rules
 * (amount with currency, upper-case ISO code, rank ≥ 1, http/https link) are
 * the backend's `domain/outcomes/validate.ts`, which answers in words.
 */
export const OutcomeInput = z
  .object({
    result: OutcomeResult,
    rank: z.int().nullish(),
    prizeText: z.string().trim().max(PRIZE_TEXT_MAX).nullish(),
    prizeMinor: z.int().nullish(),
    prizeCurrency: z.string().trim().max(3).nullish(),
    resultUrl: z.string().trim().max(RESOURCE_URI_MAX).nullish(),
    notes: z.string().trim().max(OUTCOME_TEXT_MAX).nullish(),
    feedback: z.string().trim().max(OUTCOME_TEXT_MAX).nullish(),
    /** Absent: keep the current certificate; `null`: none. */
    certificate: CertificateInput.nullish(),
    /** The outcome's version when editing; absent when recording the first time. */
    version: z.int().min(1).optional(),
  })
  .strict();
export type OutcomeInput = z.infer<typeof OutcomeInput>;

export const OutcomeDeleteRequest = z.object({ version: z.int().min(1) }).strict();
export type OutcomeDeleteRequest = z.infer<typeof OutcomeDeleteRequest>;

export const OutcomeView = z
  .object({
    competitionId: Uuid7,
    result: OutcomeResult,
    rank: z.int().min(1).nullable(),
    prizeText: z.string().nullable(),
    /** In the currency's minor units, as entered; shown with its own currency only. */
    prizeMinor: z.int().min(0).nullable(),
    prizeCurrency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
    certificate: Resource.nullable(),
    resultUrl: z.string().nullable(),
    notes: z.string().nullable(),
    feedback: z.string().nullable(),
    recordedBy: z.string().min(1),
    recordedAt: z.iso.datetime(),
    version: z.int().min(1),
  })
  .strict();
export type OutcomeView = z.infer<typeof OutcomeView>;
