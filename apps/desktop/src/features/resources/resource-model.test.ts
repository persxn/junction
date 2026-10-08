import { describe, expect, it } from 'vitest';

import { makeResource } from '../../testing/resources-api.js';
import { rowState, WEB_BUILD_TEXT, type PathStat } from './resource-model.js';

/** What a resource row says and offers (WP-20b, R102–R103), without a shell. */

const NOW = new Date('2026-10-08T10:00:00.000Z');
const COMPETITION = '0192f0c1-0000-7000-8000-00000000e001';
const path = (patch = {}) =>
  makeResource('ENGAGEMENT', COMPETITION, {
    kind: 'LOCAL_PATH',
    uri: 'C:\\Team\\deck.pptx',
    machineLabel: 'LAB-PC-01',
    ...patch,
  });
const stat = (patch: Partial<PathStat> = {}): PathStat => ({
  path: 'C:\\Team\\deck.pptx',
  status: 'OK',
  openable: true,
  reason: null,
  ...patch,
});
const state = (resource = path(), extra: Partial<Parameters<typeof rowState>[0]> = {}) =>
  rowState({ resource, shell: true, thisPc: 'LAB-PC-01', stat: stat(), now: NOW, ...extra });

describe('a resource row', () => {
  it('a link opens in the browser and has no status line', () => {
    expect(state(makeResource('ENGAGEMENT', COMPETITION))).toMatchObject({
      line: undefined,
      canOpen: true,
      canReveal: false,
    });
  });

  it('a document found on this PC opens and shows in Explorer', () => {
    expect(state()).toMatchObject({ line: undefined, canOpen: true, canReveal: true });
  });

  it('a program is shown in Explorer, never opened, and says why', () => {
    expect(state(path(), { stat: stat({ openable: false, reason: 'BLOCKED_TYPE' }) })).toEqual({
      line: 'Programs and scripts can’t be opened from CompIntel — use Show in Explorer.',
      warn: false,
      canOpen: false,
      canReveal: true,
      openHint: 'Programs and scripts can’t be opened from CompIntel — use Show in Explorer.',
    });
  });

  it('a path from another PC says where it lives and offers neither', () => {
    expect(state(path({ machineLabel: 'LAB-PC-07' }))).toMatchObject({
      line: 'On LAB-PC-07 — can’t check from here',
      warn: false,
      canOpen: false,
      canReveal: false,
    });
    // Case does not make it another PC.
    expect(state(path({ machineLabel: 'lab-pc-01' })).canOpen).toBe(true);
  });

  it('outside the desktop app a path can only be copied', () => {
    expect(state(path(), { shell: false })).toMatchObject({
      line: WEB_BUILD_TEXT,
      canOpen: false,
      canReveal: false,
    });
  });

  it('missing, unreachable, and a refused string say so', () => {
    expect(state(path(), { stat: stat({ status: 'MISSING', reason: 'NOT_FOUND' }) })).toMatchObject(
      {
        line: 'Not found on this PC — checked just now',
        warn: true,
      },
    );
    expect(state(path(), { stat: stat({ status: 'UNREACHABLE', openable: false }) }).line).toBe(
      'Network location didn’t answer',
    );
    expect(
      state(path(), { stat: stat({ status: 'MISSING', openable: false, reason: 'TRAVERSAL' }) })
        .line,
    ).toBe('A path that steps up with “..” can’t be opened from CompIntel.');
  });

  it('before this session’s check, the last check is shown with its age', () => {
    const stored = path({ checkStatus: 'MISSING', lastCheckedAt: '2026-10-08T09:58:00.000Z' });
    expect(state(stored, { stat: undefined })).toMatchObject({
      line: 'Not found on this PC — checked 2 minutes ago',
      canOpen: false,
    });
    expect(state(path(), { stat: undefined }).line).toBeUndefined();
  });
});
