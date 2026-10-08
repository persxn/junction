import type { WorkflowTemplateSummary } from '@compintel/contracts';
import { describe, expect, it } from 'vitest';

import {
  choiceOf,
  fromZonedInput,
  offeredTemplates,
  preselected,
  toZonedInput,
} from './template-choice.js';

const template = (
  id: string,
  patch: Partial<WorkflowTemplateSummary> = {},
): WorkflowTemplateSummary => ({
  id,
  name: id,
  description: null,
  appliesToEventType: null,
  isDefaultForType: false,
  isDepartmentDefault: false,
  ownerName: null,
  ownedByMe: false,
  isArchived: false,
  versionNo: 1,
  stageCount: 3,
  canEdit: false,
  ...patch,
});

describe('the template step (WP-20a step 6)', () => {
  const list = [
    template('Zeta'),
    template('CTF', { appliesToEventType: 'CTF', isDefaultForType: true }),
    template('Hackathon', { appliesToEventType: 'HACKATHON', isDefaultForType: true }),
    template('My hackathon', { appliesToEventType: 'HACKATHON' }),
    template('Old', { isArchived: true }),
  ];

  it('preselects the type’s default; OTHER gets Blank', () => {
    expect(preselected(list, 'HACKATHON')).toBe('Hackathon');
    expect(preselected(list, 'OTHER')).toBeNull();
  });

  it('offers every non-archived template, the type’s default first', () => {
    expect(offeredTemplates(list, 'HACKATHON').map((t) => t.id)).toEqual([
      'Hackathon',
      'My hackathon',
      'CTF',
      'Zeta',
    ]);
  });

  it('sends nothing before a choice, Blank without dates, a template with its edits', () => {
    expect(choiceOf({ templateId: undefined, dueOverrides: {} })).toBeUndefined();
    expect(choiceOf({ templateId: null, dueOverrides: { a: null } })).toEqual({
      templateId: null,
    });
    expect(choiceOf({ templateId: 't', dueOverrides: { a: null } })).toEqual({
      templateId: 't',
      dueOverrides: { a: null },
    });
  });

  it('date boxes are wall-clock time in Asia/Kolkata, both ways', () => {
    expect(toZonedInput('2026-10-31T18:29:00.000Z')).toBe('2026-10-31T23:59');
    expect(fromZonedInput('2026-10-31T23:59')).toBe('2026-10-31T18:29:00.000Z');
    expect(toZonedInput(null)).toBe('');
    expect(fromZonedInput('')).toBeNull();
    expect(fromZonedInput('31/10/2026')).toBeNull();
  });
});
