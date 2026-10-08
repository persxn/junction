import { z } from 'zod';

import type { EngagementStatus } from './engagement-status.js';
import type { RegistrationFilter } from './search.js';

/**
 * The Dashboard's KPI strip (§16.2, ruling R107, WP-22). Each tile is defined
 * once, as the filter of the list it opens; its number is that list's own
 * total, computed by that list's code path — never a separate COUNT. The
 * filters every side shares live here, so Discover's "Closing soon" tab and
 * the tile cannot drift apart.
 */

/** WP-16a's "Closing soon" tab's defining filter — one definition for the tab and the tile. */
export const CLOSING_SOON_REGISTRATION: RegistrationFilter = { states: ['CLOSING_SOON'] };

/** R106's "active": the statuses a competition is being worked on in. */
export const ACTIVE_COMPETITION_STATUSES: readonly EngagementStatus[] = [
  'ASSIGNED',
  'APPLIED',
  'PARTICIPATING',
];

export const KPI_KEYS = [
  'UPCOMING_EVENTS',
  'CLOSING_SOON',
  'ACTIVE_COMPETITIONS',
  'OVERDUE_TASKS',
] as const;
export const KpiKey = z.enum(KPI_KEYS);
export type KpiKey = z.infer<typeof KpiKey>;

export const KPI_LABELS: Readonly<Record<KpiKey, string>> = {
  UPCOMING_EVENTS: 'Upcoming events',
  CLOSING_SOON: 'Closing soon',
  ACTIVE_COMPETITIONS: 'Active competitions',
  OVERDUE_TASKS: 'Overdue tasks',
};

export const KPI_SCOPES = ['MINE', 'ALL'] as const;
export const KpiScope = z.enum(KPI_SCOPES);
export type KpiScope = z.infer<typeof KpiScope>;

/** Where a tile leads: a route and the search (filter) the list opens with. */
export const KpiLink = z
  .object({
    to: z.enum(['/discover', '/competitions', '/deadlines']),
    search: z.record(z.string(), z.unknown()),
  })
  .strict();
export type KpiLink = z.infer<typeof KpiLink>;

export const KpiTile = z
  .object({
    key: KpiKey,
    label: z.string().min(1),
    value: z.int().min(0),
    totalIsApproximate: z.boolean(),
    link: KpiLink,
  })
  .strict();
export type KpiTile = z.infer<typeof KpiTile>;

export const KpiResponse = z.object({ tiles: z.array(KpiTile) }).strict();
export type KpiResponse = z.infer<typeof KpiResponse>;

export const KpiQuery = z.object({ scope: KpiScope.default('MINE') }).strict();
export type KpiQuery = z.infer<typeof KpiQuery>;
