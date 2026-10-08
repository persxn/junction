import { z } from 'zod';

import { Uuid7 } from './ids.js';

/**
 * Ownership transfer (§10.4, D-20, ruling R105, WP-21): an admin moves one
 * professor's active mentor rows on active teams, open competitions and
 * mentorships to another, at one instant, with history untouched. The preview
 * is the plan in sentences plus a token; the commit is refused if anything it
 * covers has changed since.
 */

export const TransferRequest = z.object({ fromUserId: Uuid7, toUserId: Uuid7 }).strict();
export type TransferRequest = z.infer<typeof TransferRequest>;

export const PreviewToken = z.string().regex(/^[0-9a-f]{64}$/);

export const TransferCommitRequest = z
  .object({ fromUserId: Uuid7, toUserId: Uuid7, previewToken: PreviewToken })
  .strict();
export type TransferCommitRequest = z.infer<typeof TransferCommitRequest>;

export const TRANSFER_ITEM_KINDS = ['TEAM', 'COMPETITION', 'MENTORSHIP'] as const;
export const TransferItemKind = z.enum(TRANSFER_ITEM_KINDS);
export type TransferItemKind = z.infer<typeof TransferItemKind>;

export const TransferItem = z
  .object({
    kind: TransferItemKind,
    /** The team, the competition, or the student of a mentorship. */
    entityId: Uuid7,
    /** "Team Rocket", "Team Rocket — HackXYZ 2026", the student's name. */
    name: z.string().min(1),
    /** "Ada Lovelace (primary) → Grace Hopper (primary)", or why it stays. */
    sentence: z.string().min(1),
  })
  .strict();
export type TransferItem = z.infer<typeof TransferItem>;

export const TransferPerson = z.object({ userId: Uuid7, displayName: z.string().min(1) }).strict();
export type TransferPerson = z.infer<typeof TransferPerson>;

export const TransferPreview = z
  .object({
    from: TransferPerson,
    to: TransferPerson,
    teams: z.array(TransferItem),
    competitions: z.array(TransferItem),
    mentorships: z.array(TransferItem),
    /** Archived teams and closed competitions: "stays with {from} — history". */
    staysWith: z.array(TransferItem),
    previewToken: PreviewToken,
  })
  .strict();
export type TransferPreview = z.infer<typeof TransferPreview>;

export const TransferResult = z
  .object({
    teams: z.int().min(0),
    competitions: z.int().min(0),
    mentorships: z.int().min(0),
    /** One per team, competition and mentorship, plus the summary row. */
    auditRows: z.int().min(1),
  })
  .strict();
export type TransferResult = z.infer<typeof TransferResult>;
