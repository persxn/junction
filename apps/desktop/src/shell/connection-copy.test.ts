import { STARTUP_ERROR_CODES } from '@compintel/contracts';
import { describe, expect, it } from 'vitest';

import { connectionCopy, startupErrorCode } from './connection-copy.js';

describe('recognising a named startup error (ruling R26)', () => {
  it.each(STARTUP_ERROR_CODES)('finds %s in the shell message', (code) => {
    expect(startupErrorCode(`${code}: something went wrong`)).toBe(code);
  });

  it('finds it wherever in the sentence it appears', () => {
    expect(startupErrorCode('the backend refused to start (DB_CORRUPT)')).toBe('DB_CORRUPT');
  });

  it('finds nothing in a message that names no code', () => {
    expect(startupErrorCode('the backend exited with code 1')).toBeUndefined();
    expect(startupErrorCode(null)).toBeUndefined();
    expect(startupErrorCode(undefined)).toBeUndefined();
  });
});

describe('the copy for each state', () => {
  it('is terminal and retryable for a named startup error', () => {
    const copy = connectionCopy('FAILED', 'DATA_DIR_LOCKED: pid 4242');
    expect(copy.tone).toBe('danger');
    expect(copy.canRetry).toBe(true);
    expect(copy.title).toContain('already using this data folder');
  });

  it('falls back to the verbatim message when the code is unknown', () => {
    const copy = connectionCopy('FAILED', 'the backend exited with code 3221225781');
    expect(copy.body).toBe('the backend exited with code 3221225781');
    expect(copy.canRetry).toBe(true);
  });

  it('still says something when FAILED comes with no message at all', () => {
    const copy = connectionCopy('FAILED', null);
    expect(copy.body).toContain('too often');
  });

  it('does not offer Retry while the shell is already retrying', () => {
    expect(connectionCopy('RESTARTING', null).canRetry).toBe(false);
    expect(connectionCopy('STARTING', null).canRetry).toBe(false);
  });

  it('treats an unknown phase as "starting"', () => {
    expect(connectionCopy(undefined, null).title).toBe('Starting Junction');
  });

  it('says the app is closing while it shuts down', () => {
    for (const phase of ['STOPPING', 'STOPPED'] as const) {
      expect(connectionCopy(phase, null).title).toBe('Closing Junction');
    }
  });
});
