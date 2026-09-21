import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { exemptionApplies } from '../../domain/scraping/gate.js';
import { redactDeep, REDACTED } from '../../platform/redact.js';
import { secretSettingKeys, SettingsStore } from '../../platform/settings.js';
import { safeRecordPart, snapshotRef } from '../../scraping/snapshots.js';
import { missingCredentialDetail, robotsExemptionOf } from '../../scraping/source-row.js';
import { openMigratedDatabase, type MigratedDatabase } from '../../testing/database.js';
import { silentLogger } from '../../testing/scraping.js';
import '../../settings.js';
import { resolveCredential, seedDevCredentials, storeCredential } from './credentials.js';
import { SourcesRepository } from './repository.js';
import { CLIST_API_KEY, CLIST_API_USERNAME } from './settings.js';

/** WP-11: the CLIST credential, the robots exemption and the "never leaks" rules. */

let database: MigratedDatabase;
let settings: SettingsStore;
let sources: SourcesRepository;

beforeEach(() => {
  database = openMigratedDatabase(silentLogger, 'credentials');
  settings = new SettingsStore(database.db);
  sources = new SourcesRepository(database.db);
});

afterEach(() => {
  database.close();
});

const clist = () => sources.findByKey('clist')!;

describe('resolveCredential', () => {
  it('fills the seed template once both halves are set', () => {
    expect(resolveCredential(clist(), settings)).toBeUndefined();
    storeCredential(clist(), settings, { username: 'dept', apiKey: 'k3y' }, 'admin');
    expect(resolveCredential(clist(), settings)).toEqual({
      header: 'Authorization',
      value: 'ApiKey dept:k3y',
    });
  });

  it('a blank username is the same as no key', () => {
    settings.set(CLIST_API_KEY, 'k3y');
    settings.set(CLIST_API_USERNAME, '   ');
    expect(resolveCredential(clist(), settings)).toBeUndefined();
    expect(missingCredentialDetail(clist())).toBe('CLIST API key not set (U4)');
  });

  it('CTFtime needs no credential', () => {
    expect(missingCredentialDetail(sources.findByKey('ctftime')!)).toBeUndefined();
  });
});

describe('seedDevCredentials', () => {
  const env = { COMPINTEL_CLIST_API_KEY: 'k', COMPINTEL_CLIST_API_USERNAME: 'u' };

  it('seeds only in --dev, only with both halves, and never over a stored key', () => {
    expect(seedDevCredentials(settings, false, env)).toBe(false);
    expect(seedDevCredentials(settings, true, { COMPINTEL_CLIST_API_KEY: 'k' })).toBe(false);
    expect(seedDevCredentials(settings, true, env)).toBe(true);
    expect(seedDevCredentials(settings, true, { ...env, COMPINTEL_CLIST_API_KEY: 'other' })).toBe(
      false,
    );
    expect(settings.get(CLIST_API_KEY)).toBe('k');
  });
});

describe('never logged, never exported (§6.2)', () => {
  it('both settings are secret and left out of the export snapshot', () => {
    expect(secretSettingKeys()).toEqual([
      'sources.clist.apiKey',
      'sources.clist.apiUsername',
      // WP-14/R74: the professor's own session is a credential too.
      'sources.devfolio.sessionCapturedAt',
      'sources.devfolio.sessionCookie',
      'sources.unstop.sessionCapturedAt',
      'sources.unstop.sessionCookie',
    ]);
    settings.set(CLIST_API_KEY, 'k3y-value');
    settings.set(CLIST_API_USERNAME, 'dept-value');
    const exported = settings.exportableSettings();
    expect(JSON.stringify(exported)).not.toContain('k3y-value');
    expect(JSON.stringify(exported)).not.toContain('dept-value');
    expect(exported['sources.clist.apiKey']).toEqual({ isSet: true });
  });

  it('the redaction list covers the setting names and the header', () => {
    expect(
      redactDeep({
        'sources.clist.apiKey': 'x',
        'sources.clist.apiUsername': 'y',
        authorization: 'ApiKey y:x',
        credential: { header: 'Authorization', value: 'ApiKey y:x' },
      }),
    ).toEqual({
      'sources.clist.apiKey': REDACTED,
      'sources.clist.apiUsername': REDACTED,
      authorization: REDACTED,
      credential: REDACTED,
    });
  });
});

describe('the robots exemption is honoured only when all three hold', () => {
  const allowedPaths = ['clist.by/api/v4/contest/', 'clist.by/api/v4/resource/'];
  const url = new URL('https://clist.by/api/v4/contest/?limit=100');

  it('the seed carries a reviewed exemption for the two API paths', () => {
    expect(robotsExemptionOf(clist())).toMatchObject({
      paths: allowedPaths,
      reviewedAt: '2026-09-20',
    });
  });

  it('path allowed + credential + reviewer and date → applies; drop any one → does not', () => {
    const exemption = robotsExemptionOf(clist())!;
    expect(
      exemptionApplies(url, { allowedPaths, robotsExemption: exemption, credentialPresent: true }),
    ).toBe(true);
    expect(
      exemptionApplies(url, { allowedPaths, robotsExemption: exemption, credentialPresent: false }),
    ).toBe(false);
    expect(
      exemptionApplies(url, {
        allowedPaths,
        robotsExemption: { ...exemption, reviewedBy: '' },
        credentialPresent: true,
      }),
    ).toBe(false);
    expect(
      exemptionApplies(url, {
        allowedPaths,
        robotsExemption: { ...exemption, reviewedAt: 'soon' },
        credentialPresent: true,
      }),
    ).toBe(false);
    expect(
      exemptionApplies(new URL('https://clist.by/calendar/'), {
        allowedPaths,
        robotsExemption: { ...exemption, paths: ['clist.by/'] },
        credentialPresent: true,
      }),
    ).toBe(false);
  });
});

describe('snapshot file names (regression found in WP-11)', () => {
  it('a colon in an external key never reaches the file system', () => {
    expect(safeRecordPart('clist:910001')).toBe('clist_910001');
    expect(snapshotRef('clist', 'clist:910001', new Date('2026-09-21T00:00:00Z'))).toBe(
      'clist/2026-09/clist_910001-20260921T000000000Z.json.gz',
    );
  });
});
