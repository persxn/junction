import { describe, expect, it } from 'vitest';

import { ErrorCode, SETUP_ERROR_CODES } from './errors.js';
import {
  CampusInput,
  CreateUserRequest,
  PASSPHRASE_MIN_LENGTH,
  PathCheckResult,
  DepartmentSetupRequest,
  SetupRequest,
  SetupResult,
  SetupStatus,
  UpdateUserRequest,
  UserSummary,
} from './setup.js';

/**
 * The wizard's contract (rulings R39-R44). The interesting cases are the ones a
 * careless form would let through: coordinates off the globe, a contact address
 * that is not an address, and a passphrase short enough to guess.
 */

const REQUEST = {
  organization: { name: 'Example Institute of Technology', shortName: 'EIT' },
  department: { name: 'Computer Science and Engineering', code: 'CSE' },
  campus: { name: 'Main Campus', lat: 10.7594, lon: 78.8149 },
  admin: {
    email: 'admin@example.edu',
    displayName: 'A. Administrator',
    password: 'a-long-enough-password',
  },
  scraperContactEmail: 'compintel@example.edu',
  backupDir: 'D:\\Junction-backups',
  backupPassphrase: 'correct horse battery',
};

describe('SetupStatus', () => {
  it('accepts the four flags a fresh install reports', () => {
    expect(
      SetupStatus.parse({
        required: true,
        hasAdmin: false,
        hasOrganization: false,
        hasBackupKey: false,
      }).required,
    ).toBe(true);
  });

  it('refuses a status missing a flag', () => {
    expect(SetupStatus.safeParse({ required: false }).success).toBe(false);
  });
});

describe('SetupRequest', () => {
  it('accepts a filled-in wizard', () => {
    const parsed = DepartmentSetupRequest.parse(REQUEST);
    expect(parsed.campus.lat).toBeCloseTo(10.7594);
    expect(parsed.organization.shortName).toBe('EIT');
  });

  it('makes the optional fields optional and nothing else', () => {
    const { shortName: _short, ...organization } = REQUEST.organization;
    const { code: _code, ...department } = REQUEST.department;
    expect(SetupRequest.safeParse({ ...REQUEST, organization, department }).success).toBe(true);
  });

  it.each([
    ['organization', { organization: { name: 'E' } }],
    ['campus', { campus: { name: 'Main Campus' } }],
    ['admin', { admin: { ...REQUEST.admin, email: 'not-an-address' } }],
    ['scraperContactEmail', { scraperContactEmail: 'nobody' }],
    ['backupDir', { backupDir: '' }],
  ])('refuses a bad %s', (_field, patch) => {
    expect(SetupRequest.safeParse({ ...REQUEST, ...patch }).success).toBe(false);
  });

  it.each([
    ['a latitude past the pole', { lat: 90.1, lon: 0 }],
    ['a longitude past the date line', { lat: 0, lon: 180.5 }],
    ['a latitude below the south pole', { lat: -90.5, lon: 0 }],
  ])('refuses %s', (_case, coordinates) => {
    expect(CampusInput.safeParse({ name: 'Main Campus', ...coordinates }).success).toBe(false);
  });

  it('accepts the exact poles and the date line', () => {
    expect(CampusInput.safeParse({ name: 'Edge Campus', lat: 90, lon: 180 }).success).toBe(true);
    expect(CampusInput.safeParse({ name: 'Edge Campus', lat: -90, lon: -180 }).success).toBe(true);
  });

  it('refuses a passphrase below the R42 floor', () => {
    const short = 'x'.repeat(PASSPHRASE_MIN_LENGTH - 1);
    expect(SetupRequest.safeParse({ ...REQUEST, backupPassphrase: short }).success).toBe(false);
    expect(
      SetupRequest.safeParse({ ...REQUEST, backupPassphrase: 'x'.repeat(PASSPHRASE_MIN_LENGTH) })
        .success,
    ).toBe(true);
  });
});

describe('SetupResult and PathCheckResult', () => {
  it('carries the recovery code, the file name and the file', () => {
    const parsed = SetupResult.parse({
      recoveryCode: 'ABCDE-FGHJK-MNPQR-STVWX-YZ234-56789-ABCDE',
      recoveryFileName: 'junction-recovery-20260920.txt',
      recoveryFile: 'Junction recovery material\n...',
    });
    expect(parsed.recoveryFileName).toMatch(/^junction-recovery-\d{8}\.txt$/);
  });

  it('names one of the fixed reasons when a folder is refused', () => {
    const parsed = PathCheckResult.parse({
      ok: false,
      reason: 'INSIDE_DATA_DIR',
      resolvedPath: 'C:\\Junction\\data',
    });
    expect(parsed.reason).toBe('INSIDE_DATA_DIR');
    expect(
      PathCheckResult.safeParse({ ok: false, reason: 'BECAUSE', resolvedPath: 'x' }).success,
    ).toBe(false);
  });
});

describe('user administration', () => {
  const USER = {
    id: '0192f0c1-0000-7000-8000-000000000001',
    email: 'professor@example.edu',
    displayName: 'A. Professor',
    departmentId: null,
    status: 'ACTIVE',
    mustChangePassword: true,
    roles: ['PROFESSOR'],
    lastLoginAt: null,
    lockedUntil: null,
    createdAt: '2026-09-20T09:00:00.000Z',
    version: 1,
  };

  it('describes a user without ever carrying a secret', () => {
    const parsed = UserSummary.parse(USER);
    expect(parsed).not.toHaveProperty('passwordHash');
    expect(parsed.version).toBe(1);
  });

  it('needs at least one role to create a user', () => {
    expect(
      CreateUserRequest.safeParse({
        email: 'new@example.edu',
        displayName: 'New Person',
        roles: [],
      }).success,
    ).toBe(false);
  });

  it('always carries the version on an update (§6.1 optimistic concurrency)', () => {
    expect(UpdateUserRequest.safeParse({ displayName: 'Renamed' }).success).toBe(false);
    expect(UpdateUserRequest.safeParse({ displayName: 'Renamed', version: 3 }).success).toBe(true);
  });
});

describe('the setup error codes (ruling R12)', () => {
  it('are part of the one closed ErrorCode enum', () => {
    for (const code of SETUP_ERROR_CODES) {
      expect(ErrorCode.safeParse(code).success).toBe(true);
      expect(code.startsWith('SETUP_')).toBe(true);
    }
  });
});
