import { describe, expect, it } from 'vitest';

import { makeStudent } from '../../testing/students-api.js';
import {
  emptyForm,
  formFromStudent,
  toCreateRequest,
  toUpdateRequest,
  validateForm,
} from './form-model.js';

const OFF = { phoneEnabled: false, allowExternal: false };
const ON = { phoneEnabled: true, allowExternal: true };
const filled = { ...emptyForm('dept'), universityId: ' 21CS1042 ', fullName: 'Asha Rao' };

describe('validateForm', () => {
  it('needs only the roll number and the name', () => {
    expect(validateForm(emptyForm('dept'), OFF)).toEqual({
      universityId: 'Enter the roll number.',
      fullName: 'Enter the student’s full name.',
    });
    expect(validateForm(filled, OFF)).toEqual({});
  });

  it('checks an e-mail, a year and a phone in words', () => {
    const errors = validateForm(
      { ...filled, institutionalEmail: 'asha', graduationYear: '27', phone: 'call me' },
      ON,
    );
    expect(errors.institutionalEmail).toBe('This does not look like an e-mail address.');
    expect(errors.graduationYear).toBe('A year looks like 2027.');
    expect(errors.phone).toBe('Use digits, spaces and an optional leading +.');
    expect(validateForm({ ...filled, graduationYear: '1900' }, OFF).graduationYear).toBe(
      'Use a year between 1950 and 2100.',
    );
  });

  it('ignores the phone field while phone numbers are off', () => {
    expect(validateForm({ ...filled, phone: 'call me' }, OFF)).toEqual({});
  });
});

describe('the requests', () => {
  it('trims, turns empty into null and says who mentors', () => {
    const request = toCreateRequest({ ...filled, graduationYear: '2027' }, OFF);
    expect(request).toMatchObject({
      universityId: '21CS1042',
      fullName: 'Asha Rao',
      preferredName: null,
      graduationYear: 2027,
      mentorMe: true,
    });
  });

  it('sends no phone or external fields while their settings are off', () => {
    const request = toCreateRequest({ ...filled, phone: '+91 98450 00000', isExternal: true }, OFF);
    expect(request).not.toHaveProperty('phone');
    expect(request).not.toHaveProperty('isExternal');
    const allowed = toCreateRequest(
      { ...filled, phone: '+91 98450 00000', isExternal: true, externalInstitution: 'IIT' },
      ON,
    );
    expect(allowed).toMatchObject({
      phone: '+91 98450 00000',
      isExternal: true,
      externalInstitution: 'IIT',
    });
  });

  it('sends the privacy acknowledgement only when it is ticked', () => {
    expect(toCreateRequest(filled, OFF)).not.toHaveProperty('privacyNoticeShown');
    expect(toCreateRequest({ ...filled, privacyNoticeShown: true }, OFF).privacyNoticeShown).toBe(
      true,
    );
  });

  it('round-trips a stored student into an update with its version', () => {
    const student = makeStudent(1, { version: 4, preferredName: 'Ash' });
    const request = toUpdateRequest(formFromStudent(student), OFF, student.version);
    expect(request).toMatchObject({ universityId: 'DEMO0001', preferredName: 'Ash', version: 4 });
    expect(formFromStudent(student).privacyNoticeShown).toBe(true);
  });
});
