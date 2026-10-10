import { describe, expect, it } from 'vitest';

import {
  clearError,
  EMPTY_VALUES,
  nextStep,
  NUMBERED_STEPS,
  previousStep,
  toSetupRequest,
  validateStep,
  WIZARD_STEPS,
  type WizardValues,
} from './wizard-state.js';

/**
 * The wizard's rules, without a screen in sight. Nine steps drive a lot of
 * conditions, and asserting them here is what keeps the component tests about
 * what the user sees rather than about arithmetic.
 */

const FILLED: WizardValues = {
  organizationName: 'Example Institute of Technology',
  organizationShortName: 'EIT',
  departmentName: 'Computer Science and Engineering',
  departmentCode: 'CSE',
  campusName: 'Main Campus',
  campusLat: '10.7594',
  campusLon: '78.8149',
  adminEmail: 'admin@example.edu',
  adminDisplayName: 'A. Administrator',
  adminPassword: 'an-admin-password',
  adminPasswordConfirm: 'an-admin-password',
  scraperContactEmail: 'compintel@example.edu',
  backupDir: 'D:\\Junction-backups',
  backupPassphrase: 'a-different-passphrase',
  backupPassphraseConfirm: 'a-different-passphrase',
};

describe('the step order', () => {
  it('runs welcome → … → done, and lists the middle as numbered stages', () => {
    expect(WIZARD_STEPS[0]).toBe('welcome');
    expect(WIZARD_STEPS.at(-1)).toBe('done');
    expect(NUMBERED_STEPS).not.toContain('welcome');
    expect(NUMBERED_STEPS).not.toContain('done');
    expect(NUMBERED_STEPS).toHaveLength(WIZARD_STEPS.length - 2);
  });

  it('walks forwards to the end and back again', () => {
    expect(nextStep('welcome')).toBe('organization');
    expect(nextStep('done')).toBeUndefined();
    expect(previousStep('organization')).toBe('welcome');
    expect(previousStep('welcome')).toBeUndefined();
  });

  it('has no way back once the installation has been written', () => {
    // By `recovery` the transaction has committed; there is nothing left to edit.
    expect(previousStep('recovery')).toBeUndefined();
    expect(previousStep('done')).toBeUndefined();
  });
});

describe('validateStep', () => {
  it('passes a filled-in wizard at every step', () => {
    for (const step of WIZARD_STEPS) {
      expect(validateStep(step, FILLED), step).toStrictEqual({});
    }
  });

  it('asks for the institution and the department', () => {
    const errors = validateStep('organization', EMPTY_VALUES);
    expect(errors.organizationName).toBeDefined();
    expect(errors.departmentName).toBeDefined();
    // The optional ones stay quiet.
    expect(errors.organizationShortName).toBeUndefined();
    expect(errors.departmentCode).toBeUndefined();
  });

  it.each([
    ['not a number at all', 'here', '78.8', 'campusLat'],
    ['past the north pole', '91', '78.8', 'campusLat'],
    ['past the date line', '10.7', '181', 'campusLon'],
    ['empty', '', '', 'campusLat'],
  ])('refuses a latitude/longitude that is %s', (_case, lat, lon, field) => {
    const errors = validateStep('campus', { ...FILLED, campusLat: lat, campusLon: lon });
    expect(errors[field as 'campusLat']).toBeDefined();
  });

  it('accepts the exact edges of the globe', () => {
    expect(validateStep('campus', { ...FILLED, campusLat: '-90', campusLon: '180' })).toStrictEqual(
      {},
    );
  });

  it('wants a plausible e-mail and a long enough password, typed twice', () => {
    expect(
      validateStep('administrator', { ...FILLED, adminEmail: 'nobody' }).adminEmail,
    ).toBeDefined();
    expect(
      validateStep('administrator', {
        ...FILLED,
        adminPassword: 'short',
        adminPasswordConfirm: 'short',
      }).adminPassword,
    ).toBeDefined();
    expect(
      validateStep('administrator', { ...FILLED, adminPasswordConfirm: 'different' })
        .adminPasswordConfirm,
    ).toBeDefined();
  });

  it('refuses a backup passphrase equal to the Junction password (R42)', () => {
    const same = {
      ...FILLED,
      backupPassphrase: FILLED.adminPassword,
      backupPassphraseConfirm: FILLED.adminPassword,
    };
    expect(validateStep('passphrase', same).backupPassphrase).toContain('different');
  });

  it('refuses a passphrase under twelve characters, and a mistyped second one', () => {
    expect(
      validateStep('passphrase', {
        ...FILLED,
        backupPassphrase: 'short',
        backupPassphraseConfirm: 'short',
      }).backupPassphrase,
    ).toBeDefined();
    expect(
      validateStep('passphrase', { ...FILLED, backupPassphraseConfirm: 'mistyped-passphrase' })
        .backupPassphraseConfirm,
    ).toBeDefined();
  });

  it('wants a backup folder before it will move on', () => {
    expect(validateStep('folders', { ...FILLED, backupDir: '' }).backupDir).toBeDefined();
  });

  it('has nothing to say about the three steps that ask nothing', () => {
    for (const step of ['welcome', 'recovery', 'done'] as const) {
      expect(validateStep(step, EMPTY_VALUES)).toStrictEqual({});
    }
  });
});

describe('clearError', () => {
  it('removes the key rather than setting it undefined', () => {
    const errors = clearError({ adminEmail: 'wrong', campusLat: 'wrong' }, 'adminEmail');
    expect(Object.keys(errors)).toStrictEqual(['campusLat']);
  });
});

describe('toSetupRequest', () => {
  it('trims, converts the coordinates and drops the empty optionals', () => {
    const request = toSetupRequest({
      ...FILLED,
      organizationName: '  Example Institute of Technology  ',
      organizationShortName: '   ',
      departmentCode: '',
      campusLat: ' 10.7594 ',
    });

    expect(request.organization.name).toBe('Example Institute of Technology');
    expect(request.organization).not.toHaveProperty('shortName');
    expect(request.department).not.toHaveProperty('code');
    expect(request.campus.lat).toBeCloseTo(10.7594);
    expect(typeof request.campus.lon).toBe('number');
  });

  it('never trims a password or a passphrase', () => {
    const request = toSetupRequest({
      ...FILLED,
      adminPassword: '  spaces matter  ',
      backupPassphrase: '  so do these  ',
    });
    expect(request.admin.password).toBe('  spaces matter  ');
    expect(request.backupPassphrase).toBe('  so do these  ');
  });
});
