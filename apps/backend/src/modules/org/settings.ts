import { z } from 'zod';

import { define } from '../../platform/settings.js';

/**
 * Organization-wide settings that no feature module owns yet (§7.2, §7.4).
 *
 * The wizard writes all three at first run. The geography pair belongs to the
 * geography policy module WP-08b creates; when it does, these two definitions
 * move there and nothing else changes, because every reader holds the handle
 * rather than the string.
 */

/** §7.4's geography policy, as the JSON the spec prints. */
const GeographyPolicy = z.object({
  inPerson: z.object({ allowCountries: z.array(z.string().length(2)) }),
  online: z.object({ allow: z.enum(['ALL', 'ALLOWED_COUNTRIES']) }),
  hybrid: z.object({
    evaluate: z.enum(['PHYSICAL_LOCATION', 'ONLINE']),
    ifOutsideAllowed: z.enum(['SHOW_AS_ONLINE', 'HIDE']),
  }),
  unknownLocation: z.enum(['SHOW_FLAGGED', 'HIDE']),
});

/**
 * §7.2: every scraper request identifies itself with this address, and ruling
 * A10 forbids scraping until the wizard has set it. Empty means not set.
 */
export const SCRAPER_CONTACT_EMAIL = define('scraper.contactEmail', {
  schema: z.string(),
  default: '',
  description:
    'Address every scraper request identifies itself with. Scraping is off until it is set.',
});

/** §7.4, the one configurable module. The wizard writes the default; WP-08b edits it. */
export const GEOGRAPHY_POLICY = define('geography.policy', {
  schema: GeographyPolicy,
  default: {
    inPerson: { allowCountries: ['IN'] },
    online: { allow: 'ALL' as const },
    hybrid: {
      evaluate: 'PHYSICAL_LOCATION' as const,
      ifOutsideAllowed: 'SHOW_AS_ONLINE' as const,
    },
    unknownLocation: 'SHOW_FLAGGED' as const,
  },
  description: 'Which events count as relevant by where they happen (§7.4).',
});

/** How far "nearby" reaches in Discover, measured from the primary campus (§7.4). */
export const NEARBY_RADIUS_KM = define('geography.nearbyRadiusKm', {
  schema: z.int().min(1).max(5_000),
  default: 250,
  description: 'How far "nearby" reaches from the primary campus, in kilometres.',
});
