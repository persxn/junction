import type { EventMode, Uncertain } from '@compintel/contracts';

import type { WarningCollector } from './warnings.js';

/**
 * Online, offline or both (§7.3: "explicit field > keywords (online/virtual/
 * remote vs. a venue) > UNKNOWN").
 *
 * The case worth being careful about is the third one. A record that talks about
 * a virtual platform *and* names a physical venue is not a source contradicting
 * itself — it is a hybrid event, and that is a distinct thing a professor filters
 * on. Picking one keyword and ignoring the other would be a silent wrong answer.
 */

const ONLINE = /\b(?:online|virtual|remote|digital|from\s+anywhere|anywhere\s+in\s+the\s+world)\b/i;
const OFFLINE = /\b(?:offline|on[\s-]?site|in[\s-]?person|on[\s-]?campus|physical|venue)\b/i;
const HYBRID = /\b(?:hybrid|both\s+online\s+and\s+offline|online\s*(?:\+|and|&)\s*offline)\b/i;

export interface ModeInputs {
  /** The source's own field, if it has one. */
  readonly stated?: string | undefined;
  /** Title, description, location text — anywhere a keyword might be. */
  readonly text?: string | undefined;
  /** True when the record names a real venue, city or coordinates. */
  readonly hasVenue?: boolean | undefined;
}

/** Maps a source's own mode word onto the enum. */
function fromStated(stated: string): EventMode | undefined {
  const value = stated
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  if (value === 'ONLINE' || value === 'VIRTUAL' || value === 'REMOTE') {
    return 'ONLINE';
  }
  if (
    value === 'OFFLINE' ||
    value === 'ONSITE' ||
    value === 'ON_SITE' ||
    value === 'IN_PERSON' ||
    value === 'PHYSICAL'
  ) {
    return 'OFFLINE';
  }
  if (value === 'HYBRID' || value === 'BOTH') {
    return 'HYBRID';
  }
  return undefined;
}

export function parseMode(inputs: ModeInputs, warnings?: WarningCollector): Uncertain<EventMode> {
  if (inputs.stated !== undefined) {
    const stated = fromStated(inputs.stated);
    if (stated !== undefined) {
      return { value: stated, confidence: 1, raw: inputs.stated };
    }
  }

  const text = inputs.text ?? '';
  if (HYBRID.test(text)) {
    return {
      value: 'HYBRID',
      confidence: 0.85,
      ...(inputs.stated === undefined ? {} : { raw: inputs.stated }),
    };
  }

  const online = ONLINE.test(text);
  const offline = OFFLINE.test(text) || inputs.hasVenue === true;

  if (online && offline) {
    warnings?.add(
      'MODE_CONFLICT',
      'The record mentions an online format and a physical venue; recorded as hybrid.',
      'mode',
    );
    return { value: 'HYBRID', confidence: 0.6 };
  }
  if (online) {
    return { value: 'ONLINE', confidence: 0.7 };
  }
  if (offline) {
    return { value: 'OFFLINE', confidence: inputs.hasVenue === true ? 0.75 : 0.65 };
  }
  return { value: 'UNKNOWN', confidence: 1 };
}
