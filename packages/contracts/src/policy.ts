import { z } from 'zod';

import { EVENT_TYPES, EventType } from './enums.js';
import { CountryCode, Visibility } from './events.js';

/**
 * The two visibility policies (§7.4, D-31, ruling R57).
 *
 * The rule that shapes all of this is R57: **a policy hides, it never drops.**
 * An event outside the geography or event-type policy is still scraped, still
 * normalized and still stored — with `visibility = POLICY_HIDDEN` and a stable
 * `policy_reason`. Widening a policy is then a settings change that takes effect
 * on the next read, rather than a re-scrape that has to wait for a source's
 * cadence and may never recover an event the listing has since dropped.
 *
 * Both policies are data held in settings, so a department can change what it
 * cares about without a release.
 */

/** §7.4's geography policy, verbatim. */
export const GeographyPolicy = z
  .object({
    inPerson: z
      .object({
        /** ISO 3166-1 alpha-2. An in-person event elsewhere is hidden. */
        allowCountries: z.array(CountryCode).min(1),
      })
      .strict(),
    online: z
      .object({
        /** `ALL`, because an online event has no geography to be outside of. */
        allow: z.enum(['ALL', 'ALLOWED_COUNTRIES']),
      })
      .strict(),
    hybrid: z
      .object({
        /** Which half decides: where it physically is, or that it is also online. */
        evaluate: z.enum(['PHYSICAL_LOCATION', 'ONLINE']),
        /** What to do when the physical half falls outside `allowCountries` (Q12). */
        ifOutsideAllowed: z.enum(['SHOW_AS_ONLINE', 'HIDE']),
      })
      .strict(),
    /**
     * §6.1's "unknown is not false", applied to place: an event whose location
     * could not be resolved is shown with a flag, not hidden on suspicion.
     */
    unknownLocation: z.enum(['SHOW_FLAGGED', 'HIDE']),
  })
  .strict();
export type GeographyPolicy = z.infer<typeof GeographyPolicy>;

/** §7.4's JSON, exactly as the spec prints it. Q12's default lives here (R57). */
export const DEFAULT_GEOGRAPHY_POLICY: GeographyPolicy = {
  inPerson: { allowCountries: ['IN'] },
  online: { allow: 'ALL' },
  hybrid: { evaluate: 'PHYSICAL_LOCATION', ifOutsideAllowed: 'SHOW_AS_ONLINE' },
  unknownLocation: 'SHOW_FLAGGED',
};

/**
 * D-31's event-type policy: case competitions, quizzes, marketing and cultural
 * contests are out of MVP scope. Hidden with a reason rather than never stored,
 * for the same argument as geography — scope is a judgement that changes.
 */
export const EventTypePolicy = z
  .object({
    allowedTypes: z.array(EventType).min(1),
    /**
     * What to do with an event whose type could not be determined. `OTHER` is
     * not in the allowed list, so without this every unclassifiable event would
     * be hidden; `SHOW_FLAGGED` keeps it visible for a person to judge.
     */
    unknownType: z.enum(['SHOW_FLAGGED', 'HIDE']),
  })
  .strict();
export type EventTypePolicy = z.infer<typeof EventTypePolicy>;

/** D-31's five in-scope types. `OTHER` is deliberately absent. */
export const DEFAULT_EVENT_TYPE_POLICY: EventTypePolicy = {
  allowedTypes: ['HACKATHON', 'IDEATHON', 'INNOVATION_CHALLENGE', 'CTF', 'CODING_CONTEST'],
  unknownType: 'SHOW_FLAGGED',
};

/**
 * Why an event is hidden, as one stable string stored in `events.policy_reason`.
 *
 * Closed and stable because it is *stored*, not rendered from a template: a
 * professor asking "what is the policy hiding?" groups on this, and an admin
 * widening a policy needs to know which rule to widen. Changing one of these
 * strings is a data migration, not a copy edit.
 */
export const POLICY_REASONS = [
  /** The event's type is not in `allowedTypes` (D-31). */
  'EVENT_TYPE_OUT_OF_SCOPE',
  /** The type could not be determined and the policy says hide those. */
  'EVENT_TYPE_UNKNOWN',
  /** An in-person event outside `allowCountries`. */
  'IN_PERSON_OUTSIDE_ALLOWED_COUNTRIES',
  /** A hybrid event whose venue is outside, with `ifOutsideAllowed: HIDE` (Q12). */
  'HYBRID_OUTSIDE_ALLOWED_COUNTRIES',
  /** An online event, with `online.allow: ALLOWED_COUNTRIES` and no country match. */
  'ONLINE_OUTSIDE_ALLOWED_COUNTRIES',
  /** The location could not be resolved and the policy says hide those. */
  'LOCATION_UNKNOWN',
] as const;
export const PolicyReason = z.enum(POLICY_REASONS);
export type PolicyReason = z.infer<typeof PolicyReason>;

/**
 * A badge on an event the policy let through with a caveat.
 *
 * `HYBRID_ONLINE_PARTICIPATION` is Q12's answer in its current, changeable form:
 * a hybrid event abroad stays visible and says why it is still worth seeing.
 */
export const POLICY_LABELS = [
  /** "Hybrid — online participation" (Q12). */
  'HYBRID_ONLINE_PARTICIPATION',
  /** "Location not stated" — shown, flagged, for a person to judge. */
  'LOCATION_UNKNOWN',
  /** "Type not stated" — the same, for the event-type policy. */
  'EVENT_TYPE_UNKNOWN',
] as const;
export const PolicyLabel = z.enum(POLICY_LABELS);
export type PolicyLabel = z.infer<typeof PolicyLabel>;

/** The words each label renders as. One place, so the UI cannot invent its own. */
export const POLICY_LABEL_TEXT: Readonly<Record<PolicyLabel, string>> = {
  HYBRID_ONLINE_PARTICIPATION: 'Hybrid — online participation',
  LOCATION_UNKNOWN: 'Location not stated',
  EVENT_TYPE_UNKNOWN: 'Type not stated',
};

/**
 * What the policies decide about one event.
 *
 * `visibility` is narrowed to the two values a policy may produce: it can make
 * an event `VISIBLE` or `POLICY_HIDDEN` and nothing else. `ADMIN_HIDDEN` is a
 * person's decision and `MERGED` is dedup's; neither is a policy's to make.
 */
export const PolicyVerdict = z
  .object({
    visibility: Visibility.extract(['VISIBLE', 'POLICY_HIDDEN']),
    /** Present exactly when `visibility` is `POLICY_HIDDEN`. */
    reason: PolicyReason.optional(),
    /** A caveat badge on an event that was *not* hidden. */
    label: PolicyLabel.optional(),
  })
  .strict()
  .refine(
    (verdict) => (verdict.visibility === 'POLICY_HIDDEN') === (verdict.reason !== undefined),
    {
      message: 'A hidden event needs a reason, and a visible one cannot have had one.',
    },
  );
export type PolicyVerdict = z.infer<typeof PolicyVerdict>;

/**
 * The distance rings Discover offers (D-06), in kilometres. Straight-line —
 * see `domain/geo/distance.ts` for why that wording is fixed.
 */
export const DISTANCE_BUCKETS_KM = [50, 100, 250, 500] as const;
export type DistanceBucketKm = (typeof DISTANCE_BUCKETS_KM)[number];

/** Every type the policy could allow, for the admin screen's checklist. */
export const SELECTABLE_EVENT_TYPES = EVENT_TYPES;
