import { DUE_ANCHOR_LABELS, type DueRule } from '@compintel/contracts';

import { DEADLINE_KIND_LABELS } from '../../discover/detail/DeadlineTimeline.js';

/**
 * A due rule in words (R100): "2 days before the registration deadline",
 * "on the event's end", "7 days after the Final submission date".
 */
export function ruleText(rule: DueRule | null): string {
  if (rule === null) return 'No date rule — set dates by hand';
  const anchor =
    rule.anchor === 'DEADLINE' && rule.kind !== undefined
      ? `the ${DEADLINE_KIND_LABELS[rule.kind].toLowerCase()} date`
      : `the ${DUE_ANCHOR_LABELS[rule.anchor].toLowerCase()}`;
  const days = Math.abs(rule.offsetDays);
  if (rule.offsetDays === 0) return `On ${anchor}`;
  const count = `${String(days)} ${days === 1 ? 'day' : 'days'}`;
  return `${count} ${rule.offsetDays < 0 ? 'before' : 'after'} ${anchor}`;
}
