import type { EventType, WorkflowChoiceInput, WorkflowTemplateSummary } from '@compintel/contracts';

import { DISPLAY_ZONE } from '../discover/format.js';

/**
 * The "Workflow template" and "Review dates" steps' pure parts (WP-20a step
 * 6, §11, R100): which template is preselected, what the choice sends, and
 * the date boxes, which are wall-clock time in the display zone.
 */

export interface WorkflowDraft {
  /** A template id, `null` for "Blank workflow", `undefined` before the step has chosen. */
  readonly templateId: string | null | undefined;
  /** Review-dates edits by template stage id: an ISO date (→ MANUAL) or `null` (→ no date). */
  readonly dueOverrides: Readonly<Record<string, string | null>>;
}

export const EMPTY_WORKFLOW_DRAFT: WorkflowDraft = { templateId: undefined, dueOverrides: {} };

/** The choices offered: every non-archived template, the type's ones first. */
export function offeredTemplates(
  templates: readonly WorkflowTemplateSummary[],
  eventType: EventType,
): WorkflowTemplateSummary[] {
  const rank = (template: WorkflowTemplateSummary): number =>
    template.appliesToEventType === eventType ? (template.isDefaultForType ? 0 : 1) : 2;
  return templates
    .filter((template) => !template.isArchived)
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** The department default for the event's type; OTHER has none, so Blank. */
export function preselected(
  templates: readonly WorkflowTemplateSummary[],
  eventType: EventType,
): string | null {
  return (
    templates.find(
      (template) =>
        !template.isArchived &&
        template.isDefaultForType &&
        template.appliesToEventType === eventType,
    )?.id ?? null
  );
}

/** What the request carries; nothing until the step has chosen. */
export function choiceOf(draft: WorkflowDraft): WorkflowChoiceInput | undefined {
  if (draft.templateId === undefined) return undefined;
  return draft.templateId === null
    ? { templateId: null }
    : { templateId: draft.templateId, dueOverrides: { ...draft.dueOverrides } };
}

const LOCAL_MINUTE = new Intl.DateTimeFormat('en-CA', {
  timeZone: DISPLAY_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** An ISO instant as an `<input type="datetime-local">` value in the display zone. */
export function toZonedInput(iso: string | null): string {
  if (iso === null) return '';
  const parts = LOCAL_MINUTE.formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

/** Asia/Kolkata keeps +05:30 all year (no daylight saving), so the offset is fixed. */
const DISPLAY_OFFSET = '+05:30';

/** A datetime-local value read in the display zone; empty or malformed → `null`. */
export function fromZonedInput(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const at = Date.parse(`${value}:00${DISPLAY_OFFSET}`);
  return Number.isNaN(at) ? null : new Date(at).toISOString();
}
