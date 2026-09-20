import { z } from 'zod';
import {
  DEFAULT_EVENT_TYPE_POLICY,
  DEFAULT_GEOGRAPHY_POLICY,
  EventTypePolicy,
  GeographyPolicy,
} from '@compintel/contracts';

import { define } from '../../platform/settings.js';

/**
 * The settings the two visibility policies read (§7.4, ruling R57).
 *
 * Declared here, by the module that owns them, rather than in a central list —
 * pre-M1 made that possible and its comment in `modules/org/settings.ts`
 * predicted this exact move. `geography.policy` and `geography.nearbyRadiusKm`
 * came from there; nothing else changed, because every reader holds the typed
 * handle rather than the string.
 */

/** §7.4, the one configurable module. The wizard writes the default. */
export const GEOGRAPHY_POLICY = define('geography.policy', {
  schema: GeographyPolicy,
  default: DEFAULT_GEOGRAPHY_POLICY,
  description: 'Which events count as relevant by where they happen (§7.4).',
});

/** How far "nearby" reaches in Discover, measured from the primary campus (§7.4). */
export const NEARBY_RADIUS_KM = define('geography.nearbyRadiusKm', {
  schema: z.int().min(1).max(5_000),
  default: 250,
  description: 'How far "nearby" reaches from the primary campus, in kilometres.',
});

/**
 * D-31's scope. Separate from the geography policy because the two answer
 * different questions and an admin widens them for different reasons.
 */
export const EVENT_TYPE_POLICY = define('eventType.policy', {
  schema: EventTypePolicy,
  default: DEFAULT_EVENT_TYPE_POLICY,
  description: 'Which kinds of competition are in scope (§7.4, D-31).',
});
