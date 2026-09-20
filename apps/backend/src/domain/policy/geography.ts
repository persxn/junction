import type { EventMode, GeographyPolicy, PolicyVerdict } from '@compintel/contracts';

/**
 * The geography policy (§7.4, ruling R57).
 *
 * A department in Kolkata does not want a feed full of in-person hackathons in
 * Seoul. It very much does want the online ones, and it probably wants the
 * hybrid ones — which is Q12, still open, and therefore a setting rather than a
 * decision baked in here.
 *
 * The verdict is **stored**, never applied as a filter at query time. That is
 * R57 and it is what makes widening the policy cheap: an event hidden in March
 * because it was in Korea becomes visible the moment `allowCountries` gains
 * `KR`, with no re-scrape and no dependence on the source still listing it.
 */

export interface GeographyFacts {
  readonly mode: EventMode;
  /** ISO 3166-1 alpha-2 of where it physically happens, if that is known. */
  readonly countryCode?: string | undefined;
}

const allowed = (policy: GeographyPolicy, countryCode: string | undefined): boolean =>
  countryCode !== undefined &&
  policy.inPerson.allowCountries.some((allowedCode) => allowedCode === countryCode.toUpperCase());

const visible: PolicyVerdict = { visibility: 'VISIBLE' };

/**
 * Decides whether an event's *place* keeps it in the feed.
 *
 * Reads as four independent questions — one per mode — because that is how the
 * policy is written and how an admin reasons about it. Collapsing them into a
 * single expression would be shorter and much harder to argue with.
 */
export function applyGeographyPolicy(
  facts: GeographyFacts,
  policy: GeographyPolicy,
): PolicyVerdict {
  // ONLINE: there is no geography to be outside of, unless the policy explicitly
  // says an online event still has to belong to an allowed country.
  if (facts.mode === 'ONLINE') {
    if (policy.online.allow === 'ALL') {
      return visible;
    }
    return allowed(policy, facts.countryCode)
      ? visible
      : { visibility: 'POLICY_HIDDEN', reason: 'ONLINE_OUTSIDE_ALLOWED_COUNTRIES' };
  }

  // UNKNOWN location: §6.1's "unknown is not false". Shown with a flag by
  // default, so a person decides rather than the absence of data deciding.
  if (facts.countryCode === undefined) {
    if (facts.mode === 'UNKNOWN' || facts.mode === 'OFFLINE' || facts.mode === 'HYBRID') {
      return policy.unknownLocation === 'SHOW_FLAGGED'
        ? { visibility: 'VISIBLE', label: 'LOCATION_UNKNOWN' }
        : { visibility: 'POLICY_HIDDEN', reason: 'LOCATION_UNKNOWN' };
    }
  }

  // HYBRID: Q12. Which half decides is configurable, and when the physical half
  // is outside, whether to show it as an online opportunity is too.
  if (facts.mode === 'HYBRID') {
    if (policy.hybrid.evaluate === 'ONLINE') {
      return visible;
    }
    if (allowed(policy, facts.countryCode)) {
      return visible;
    }
    return policy.hybrid.ifOutsideAllowed === 'SHOW_AS_ONLINE'
      ? { visibility: 'VISIBLE', label: 'HYBRID_ONLINE_PARTICIPATION' }
      : { visibility: 'POLICY_HIDDEN', reason: 'HYBRID_OUTSIDE_ALLOWED_COUNTRIES' };
  }

  // OFFLINE, and an UNKNOWN mode with a known country — treated as physical,
  // because a country was stated and that is the only fact available.
  return allowed(policy, facts.countryCode)
    ? visible
    : { visibility: 'POLICY_HIDDEN', reason: 'IN_PERSON_OUTSIDE_ALLOWED_COUNTRIES' };
}
