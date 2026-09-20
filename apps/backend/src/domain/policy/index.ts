import type { EventTypePolicy, GeographyPolicy, PolicyVerdict } from '@compintel/contracts';

import { applyEventTypePolicy, type EventTypeFacts } from './event-type.js';
import { applyGeographyPolicy, type GeographyFacts } from './geography.js';

export * from './event-type.js';
export * from './geography.js';

/**
 * Both policies, in the order that produces one stable `policy_reason` (R57).
 *
 * Event type first, then geography. The order is not arbitrary: an event can
 * fail both, and `events.policy_reason` holds exactly one string. Type is the
 * more fundamental judgement — a quiz in Mumbai is out of scope whatever the
 * geography policy says — so it gets to be the reason. Reversing this would make
 * the stored reason depend on which rule happened to run first, and an admin
 * would widen the wrong one.
 *
 * Labels accumulate rather than compete: an event can be both "hybrid — online
 * participation" and "type not stated", and both are worth showing. The first
 * one wins the badge, and the rest are available to a caller that wants them.
 */
export interface PolicyFacts extends GeographyFacts, EventTypeFacts {}

export interface PolicyDecision extends PolicyVerdict {
  /** Every caveat that applied, in the order the policies ran. */
  readonly labels: readonly NonNullable<PolicyVerdict['label']>[];
}

export function applyPolicies(
  facts: PolicyFacts,
  policies: { readonly eventType: EventTypePolicy; readonly geography: GeographyPolicy },
): PolicyDecision {
  const labels: NonNullable<PolicyVerdict['label']>[] = [];

  for (const verdict of [
    applyEventTypePolicy(facts, policies.eventType),
    applyGeographyPolicy(facts, policies.geography),
  ]) {
    if (verdict.visibility === 'POLICY_HIDDEN') {
      // The first hiding verdict is the reason, and nothing after it matters.
      return {
        visibility: 'POLICY_HIDDEN',
        ...(verdict.reason === undefined ? {} : { reason: verdict.reason }),
        labels,
      };
    }
    if (verdict.label !== undefined) {
      labels.push(verdict.label);
    }
  }

  const first = labels[0];
  return {
    visibility: 'VISIBLE',
    ...(first === undefined ? {} : { label: first }),
    labels,
  };
}
