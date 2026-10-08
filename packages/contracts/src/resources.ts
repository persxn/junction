import { z } from 'zod';

import { Uuid7 } from './ids.js';

/**
 * Resources (§6.2 `resources`, §13, ADR-0013, rulings R102–R103, WP-20b):
 * references to material — links, repositories, cloud documents, paths on a
 * PC — attached to a competition, a stage, a task or an outcome. Nothing is
 * ever copied into the app (D-12), a link is never fetched, and a path is
 * checked only by the shell on the PC that can see it.
 */

/** OUTCOME uses the competition's id, the outcome's key (R103). */
export const RESOURCE_OWNER_KINDS = ['ENGAGEMENT', 'STAGE', 'TASK', 'OUTCOME'] as const;
export const ResourceOwnerKind = z.enum(RESOURCE_OWNER_KINDS);
export type ResourceOwnerKind = z.infer<typeof ResourceOwnerKind>;

export const RESOURCE_OWNER_LABELS: Readonly<Record<ResourceOwnerKind, string>> = {
  ENGAGEMENT: 'Competition',
  STAGE: 'Stage',
  TASK: 'Task',
  OUTCOME: 'Outcome',
};

export const RESOURCE_KINDS = ['URL', 'GITHUB', 'CLOUD_DOC', 'LOCAL_PATH', 'OTHER'] as const;
export const ResourceKind = z.enum(RESOURCE_KINDS);
export type ResourceKind = z.infer<typeof ResourceKind>;

export const RESOURCE_KIND_LABELS: Readonly<Record<ResourceKind, string>> = {
  URL: 'Web link',
  GITHUB: 'GitHub repository',
  CLOUD_DOC: 'Cloud document',
  LOCAL_PATH: 'File or folder on a PC',
  OTHER: 'Other link',
};

export const CHECK_STATUSES = ['OK', 'MISSING', 'UNREACHABLE', 'UNCHECKED'] as const;
export const CheckStatus = z.enum(CHECK_STATUSES);
export type CheckStatus = z.infer<typeof CheckStatus>;

export const CHECK_STATUS_LABELS: Readonly<Record<CheckStatus, string>> = {
  OK: 'Found',
  MISSING: 'Not found on this PC',
  UNREACHABLE: 'Network location didn’t answer',
  UNCHECKED: 'Not checked',
};

/** A check the shell made: never UNCHECKED (that is the absence of a check). */
export const CHECKED_STATUSES = ['OK', 'MISSING', 'UNREACHABLE'] as const;
export const CheckedStatus = z.enum(CHECKED_STATUSES);
export type CheckedStatus = z.infer<typeof CheckedStatus>;

export const RESOURCE_URI_MAX = 2048;
export const RESOURCE_LABEL_MAX = 120;
export const MACHINE_LABEL_MAX = 64;

export const Resource = z
  .object({
    id: Uuid7,
    ownerKind: ResourceOwnerKind,
    ownerId: Uuid7,
    kind: ResourceKind,
    label: z.string().min(1).max(RESOURCE_LABEL_MAX),
    uri: z.string().min(1).max(RESOURCE_URI_MAX),
    /** LOCAL_PATH only: the PC it was added on ("On LAB-PC-07"). */
    machineLabel: z.string().max(MACHINE_LABEL_MAX).nullable(),
    checkStatus: CheckStatus,
    lastCheckedAt: z.iso.datetime().nullable(),
    addedBy: z.string().min(1),
    addedAt: z.iso.datetime(),
    version: z.int().min(1),
  })
  .strict();
export type Resource = z.infer<typeof Resource>;

/** One owner's resources, in the order they were added. */
export const ResourceGroup = z
  .object({
    ownerKind: ResourceOwnerKind,
    ownerId: Uuid7,
    /** "Competition", the stage's name, the task's title, "Outcome". */
    ownerLabel: z.string().min(1),
    resources: z.array(Resource),
  })
  .strict();
export type ResourceGroup = z.infer<typeof ResourceGroup>;

/** `GET /competitions/:id/resources`: every level of one competition. */
export const ResourceList = z
  .object({
    competitionId: Uuid7,
    groups: z.array(ResourceGroup),
    /** The caller may add, edit and remove (R96's mentors, or an admin) — cosmetic. */
    canEdit: z.boolean(),
  })
  .strict();
export type ResourceList = z.infer<typeof ResourceList>;

const Label = z.string().trim().min(1).max(RESOURCE_LABEL_MAX);
const Uri = z.string().trim().min(1).max(RESOURCE_URI_MAX);
const MachineLabel = z.string().trim().min(1).max(MACHINE_LABEL_MAX);

export const ResourceCreateRequest = z
  .object({
    ownerKind: ResourceOwnerKind,
    ownerId: Uuid7,
    uri: Uri,
    /** Absent → detected from the text; present → must fit it (R103). */
    kind: ResourceKind.optional(),
    /** Absent → derived from the link or the file name. */
    label: Label.optional(),
    /** LOCAL_PATH: the shell's `machine_label()`; refused for the other kinds. */
    machineLabel: MachineLabel.optional(),
  })
  .strict();
export type ResourceCreateRequest = z.infer<typeof ResourceCreateRequest>;

export const ResourceUpdateRequest = z
  .object({
    label: Label.optional(),
    uri: Uri.optional(),
    kind: ResourceKind.optional(),
    machineLabel: MachineLabel.nullish(),
    version: z.int().min(1),
  })
  .strict();
export type ResourceUpdateRequest = z.infer<typeof ResourceUpdateRequest>;

export const ResourceDeleteRequest = z.object({ version: z.int().min(1) }).strict();
export type ResourceDeleteRequest = z.infer<typeof ResourceDeleteRequest>;

/** What the shell found, posted back (R103: machine state — no audit, no version bump). */
export const CheckResultsRequest = z
  .object({
    results: z
      .array(z.object({ id: Uuid7, status: CheckedStatus, checkedAt: z.iso.datetime() }).strict())
      .min(1)
      .max(200),
  })
  .strict();
export type CheckResultsRequest = z.infer<typeof CheckResultsRequest>;

export const CheckResultsResponse = z.object({ updated: z.int().min(0) }).strict();
export type CheckResultsResponse = z.infer<typeof CheckResultsResponse>;
