import type { UrlImportResult } from '@compintel/contracts';
import { describe, expect, it } from 'vitest';

import {
  canSave,
  editedOverrides,
  EMPTY_FORM,
  fromPreview,
  toManualInput,
  whySaveDisabled,
} from './form-state.js';

/** The form's two decisions, without rendering anything (WP-14 step 8). */

const PREVIEW: UrlImportResult = {
  disposition: 'GENERIC',
  url: 'https://fest.example.ac.in/techfest-2026',
  fieldsFound: [
    {
      field: 'title',
      label: 'Title',
      value: 'TechFest 2026',
      confidence: 0.8,
      origin: 'OPEN_GRAPH',
    },
    {
      field: 'startsAt',
      label: 'Starts',
      value: '2026-12-12T09:00:00.000Z',
      confidence: 0.5,
      origin: 'HEURISTIC',
    },
    {
      field: 'feeText',
      label: 'Entry fee',
      value: 'Free',
      confidence: 0.5,
      origin: 'HEURISTIC',
    },
  ],
  fieldsMissing: ['Place'],
  warnings: [],
};

describe('when Save is allowed', () => {
  it('needs a title and something to find the event by again (§7.5)', () => {
    expect(whySaveDisabled(EMPTY_FORM)).toBe('An event needs a title.');
    expect(whySaveDisabled({ ...EMPTY_FORM, title: 'X' })).toBe(
      'Add a date or a link, so the event can be found again.',
    );
    expect(canSave({ ...EMPTY_FORM, title: 'X', startsAt: '2026-10-20T09:00' })).toBe(true);
    expect(canSave({ ...EMPTY_FORM, title: 'X', registrationUrl: 'https://e.test/r' })).toBe(true);
  });
});

describe('what gets sent', () => {
  it('leaves an empty box out rather than sending an empty value (§6.1)', () => {
    const body = toManualInput({ ...EMPTY_FORM, title: '  Ideathon  ', city: '  ' });
    expect(body).toEqual({ title: 'Ideathon' });
    expect(Object.keys(body)).not.toContain('city');
  });

  it('upper-cases a country code and groups the place into one field', () => {
    const body = toManualInput({ ...EMPTY_FORM, title: 'X', city: 'Pune', countryCode: 'in' });
    expect(body.place).toEqual({ city: 'Pune', countryCode: 'IN' });
  });

  it('maps one typed box to every stored field it stands behind', () => {
    expect(editedOverrides(new Set(['feeText']))).toEqual([
      'feeKnown',
      'feeMinor',
      'feeCurrency',
      'feeText',
    ]);
    expect(editedOverrides(new Set(['title', 'teamSizeText']))).toEqual([
      'title',
      'teamMin',
      'teamMax',
    ]);
    expect(editedOverrides(new Set())).toEqual([]);
  });
});

describe('filling the form from a preview', () => {
  it('marks the low-confidence values and keeps where each came from', () => {
    const { form, uncertain, origins } = fromPreview(PREVIEW);
    expect(form.title).toBe('TechFest 2026');
    expect(uncertain.has('title')).toBe(false);
    expect(uncertain.has('startsAt')).toBe(true);
    expect(origins.get('feeText')?.origin).toBe('HEURISTIC');
  });

  it('turns an instant into something a date box can show', () => {
    expect(fromPreview(PREVIEW).form.startsAt).toBe('2026-12-12T09:00');
  });

  it('keeps prose the professor will have to correct, rather than dropping it', () => {
    const prose = {
      ...PREVIEW,
      fieldsFound: [
        {
          field: 'startsAt',
          label: 'Starts',
          value: 'the second weekend of December',
          confidence: 0.4,
          origin: 'HEURISTIC' as const,
        },
      ],
    };
    expect(fromPreview(prose).form.startsAt).toBe('the second weekend of December');
  });

  it('always keeps the link, which is the whole of a MANUAL_ONLY answer (D-30)', () => {
    const manualOnly: UrlImportResult = {
      disposition: 'MANUAL_ONLY',
      url: 'https://devpost.com/software/x',
      sourceKey: 'devpost',
      sourceName: 'Devpost',
      reason: 'Devpost does not allow automated reading.',
      fieldsFound: [],
      fieldsMissing: ['Title'],
      warnings: [],
    };
    expect(fromPreview(manualOnly).form.officialUrl).toBe('https://devpost.com/software/x');
  });
});
