import { z } from 'zod';

import { DatePrecision, EventMode } from './enums.js';
import { ChangeCause, CountryCode, Instant, OverrideField, Visibility } from './events.js';
import { Uuid7 } from './ids.js';

/**
 * Duplicate detection, merge review, conflicts and change history (§7.5, WP-10).
 *
 * The score is §7.5's four weighted features plus the URL rule, and every
 * candidate carries its breakdown: an administrator deciding whether two rows
 * are one event needs to see *why* the machine thought so, not a bare number.
 */

/** Each feature is 0–1; `urlMatch` is the §7.5 near-certain rule, scored 1.0 on its own. */
export const DedupFeatures = z
  .object({
    title: z.number().min(0).max(1),
    organizer: z.number().min(0).max(1),
    dateProximity: z.number().min(0).max(1),
    locationMode: z.number().min(0).max(1),
    urlMatch: z.boolean(),
  })
  .strict();
export type DedupFeatures = z.infer<typeof DedupFeatures>;

export const DedupScore = z
  .object({
    total: z.number().min(0).max(1),
    features: DedupFeatures,
  })
  .strict();
export type DedupScore = z.infer<typeof DedupScore>;

export const DEDUP_DECISIONS = ['AUTO_MERGE', 'CANDIDATE', 'NEW'] as const;
export const DedupDecision = z.enum(DEDUP_DECISIONS);
export type DedupDecision = z.infer<typeof DedupDecision>;

export const DEDUP_CANDIDATE_STATUSES = ['PENDING', 'MERGED', 'REJECTED'] as const;
export const DedupCandidateStatus = z.enum(DEDUP_CANDIDATE_STATUSES);
export type DedupCandidateStatus = z.infer<typeof DedupCandidateStatus>;

/**
 * The §7.5 weights (R65). A schema, not four loose numbers, so "they sum to
 * 1.0" is checked where they are stored rather than hoped for where they are
 * read.
 */
export const DedupWeights = z
  .object({
    title: z.number().min(0).max(1),
    organizer: z.number().min(0).max(1),
    dateProximity: z.number().min(0).max(1),
    locationMode: z.number().min(0).max(1),
  })
  .strict()
  .refine(
    (weights) =>
      Math.abs(
        weights.title + weights.organizer + weights.dateProximity + weights.locationMode - 1,
      ) < 1e-9,
    { message: 'The four dedup weights must sum to 1.0.' },
  );
export type DedupWeights = z.infer<typeof DedupWeights>;

/**
 * Everything scoring reads, as one object, with R65's second check: the
 * candidate threshold is below the auto-merge one, or the grey band is empty
 * and every near-duplicate silently merges.
 */
export const DedupConfig = z
  .object({
    autoMergeThreshold: z.number().gt(0).max(1),
    candidateThreshold: z.number().gt(0).max(1),
    weights: DedupWeights,
  })
  .strict()
  .refine((config) => config.candidateThreshold < config.autoMergeThreshold, {
    message: 'dedup.candidateThreshold must be below dedup.autoMergeThreshold.',
  });
export type DedupConfig = z.infer<typeof DedupConfig>;

/** One side of a candidate pair, as the review screen lists it. */
export const DedupEventBrief = z
  .object({
    id: Uuid7,
    title: z.string(),
    editionYear: z.int().nullable(),
    organizerName: z.string().nullable(),
    mode: EventMode,
    city: z.string().nullable(),
    countryCode: CountryCode.nullable(),
    startsAt: Instant.nullable(),
    registrationDeadlineAt: Instant.nullable(),
    datePrecision: DatePrecision,
    officialUrl: z.string().nullable(),
    visibility: Visibility,
    sourceKeys: z.array(z.string()),
  })
  .strict();
export type DedupEventBrief = z.infer<typeof DedupEventBrief>;

export const DedupCandidateDto = z
  .object({
    id: Uuid7,
    status: DedupCandidateStatus,
    score: DedupScore,
    eventA: DedupEventBrief,
    eventB: DedupEventBrief,
    createdAt: Instant,
    decidedAt: Instant.nullable(),
    decidedBy: Uuid7.nullable(),
    version: z.int().min(1),
  })
  .strict();
export type DedupCandidateDto = z.infer<typeof DedupCandidateDto>;

export const DedupCandidateQuery = z
  .object({
    status: DedupCandidateStatus.default('PENDING'),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();
export type DedupCandidateQuery = z.infer<typeof DedupCandidateQuery>;

export const DedupCandidateList = z
  .object({ items: z.array(DedupCandidateDto), total: z.int().min(0) })
  .strict();
export type DedupCandidateList = z.infer<typeof DedupCandidateList>;

/** The candidate's `version`, for §6.1's optimistic concurrency. */
export const MergeRequest = z.object({ version: z.int().min(1) }).strict();
export type MergeRequest = z.infer<typeof MergeRequest>;

export const RejectRequest = MergeRequest;
export type RejectRequest = MergeRequest;

/** The merged-away event's `version`. */
export const UnmergeRequest = z.object({ version: z.int().min(1) }).strict();
export type UnmergeRequest = z.infer<typeof UnmergeRequest>;

export const MergeResult = z
  .object({ survivorId: Uuid7, mergedId: Uuid7, candidate: DedupCandidateDto })
  .strict();
export type MergeResult = z.infer<typeof MergeResult>;

export const UnmergeResult = z.object({ restoredId: Uuid7, fromEventId: Uuid7 }).strict();
export type UnmergeResult = z.infer<typeof UnmergeResult>;

/** One source's value for a field, as "Sources disagree" shows it (WP-16b). */
export const ConflictValue = z
  .object({
    /** The value as JSON-decoded; `null` is a claim that the field is empty. */
    value: z.json(),
    sourceKey: z.string(),
    sourceRecordId: z.string(),
    trustRank: z.int(),
    observedAt: Instant,
    /** R63: a second statement by the same source that lost to its structured field. */
    alternate: z.boolean(),
    note: z.string().nullable(),
  })
  .strict();
export type ConflictValue = z.infer<typeof ConflictValue>;

export const ConflictDto = z
  .object({
    field: OverrideField,
    /** True when §7.5 calls the disagreement material (dates > 1 h, team size, fee, mode, R63). */
    material: z.boolean(),
    values: z.array(ConflictValue),
    /** The value on the event row; exactly one claim's or an override's. */
    selected: z.json(),
    selectedFrom: z.enum(['CLAIM', 'OVERRIDE']),
  })
  .strict();
export type ConflictDto = z.infer<typeof ConflictDto>;

export const EventConflicts = z
  .object({ eventId: Uuid7, hasConflicts: z.boolean(), conflicts: z.array(ConflictDto) })
  .strict();
export type EventConflicts = z.infer<typeof EventConflicts>;

export const EventChangeDto = z
  .object({
    id: Uuid7,
    field: OverrideField,
    oldValue: z.json(),
    newValue: z.json(),
    cause: ChangeCause,
    sourceRecordId: z.string().nullable(),
    changedBy: Uuid7.nullable(),
    detectedAt: Instant,
  })
  .strict();
export type EventChangeDto = z.infer<typeof EventChangeDto>;

export const EventChangesQuery = z
  .object({
    cursor: Uuid7.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export type EventChangesQuery = z.infer<typeof EventChangesQuery>;

export const EventChangePage = z
  .object({ items: z.array(EventChangeDto), nextCursor: Uuid7.nullable() })
  .strict();
export type EventChangePage = z.infer<typeof EventChangePage>;
