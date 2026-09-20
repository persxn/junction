import { z } from 'zod';

import { define } from '../../platform/settings.js';

/**
 * Organization-wide settings that no feature module owns.
 *
 * The geography pair that used to live here moved to `modules/geo/settings.ts`
 * when WP-08b created the policy module, exactly as this file predicted. Nothing
 * else changed: every reader holds the typed handle, not the string.
 */

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
