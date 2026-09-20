import type { EventType, EventTypePolicy, PolicyVerdict } from '@compintel/contracts';

/**
 * The event-type policy (§7.4, D-31, ruling R57).
 *
 * D-31 puts case competitions, quizzes, marketing contests and cultural events
 * out of MVP scope. They still get scraped and stored — hiding is a *verdict*,
 * not a drop (R57) — so a department that later decides it does care about case
 * competitions gets its back catalogue by flipping a setting.
 *
 * `OTHER` is deliberately not in the default allowed list, and equally
 * deliberately not treated as "hide it": an event we could not classify is not
 * the same as an event we classified as out of scope. `unknownType` decides,
 * and it defaults to showing it flagged, because the alternative is silently
 * burying everything the classifier failed on.
 */

export interface EventTypeFacts {
  readonly eventType: EventType;
  /**
   * How sure the normalizer was. A confident `OTHER` means "this really is
   * something else"; an unconfident one means "we could not tell".
   */
  readonly confidence?: number | undefined;
}

/** Below this, an `OTHER` is treated as "could not tell" rather than as a verdict. */
export const UNCERTAIN_TYPE_BELOW = 0.9;

export function applyEventTypePolicy(
  facts: EventTypeFacts,
  policy: EventTypePolicy,
): PolicyVerdict {
  if (policy.allowedTypes.includes(facts.eventType)) {
    return { visibility: 'VISIBLE' };
  }

  // Unclassifiable, rather than classified as out of scope.
  const unsure =
    facts.eventType === 'OTHER' &&
    (facts.confidence === undefined || facts.confidence < UNCERTAIN_TYPE_BELOW);
  if (unsure) {
    return policy.unknownType === 'SHOW_FLAGGED'
      ? { visibility: 'VISIBLE', label: 'EVENT_TYPE_UNKNOWN' }
      : { visibility: 'POLICY_HIDDEN', reason: 'EVENT_TYPE_UNKNOWN' };
  }

  return { visibility: 'POLICY_HIDDEN', reason: 'EVENT_TYPE_OUT_OF_SCOPE' };
}
