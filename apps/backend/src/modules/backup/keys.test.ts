import { Decrypter, Encrypter } from 'age-encryption';
import { describe, expect, it } from 'vitest';

import {
  generateBackupKeys,
  recoveryFileName,
  renderRecoveryFile,
  unwrapIdentity,
  wrapIdentity,
} from './keys.js';

/**
 * Ruling R42. The test that matters is the whole round trip — encrypt something
 * to the stored public key, then get it back using only the passphrase and what
 * is on disk — because that is exactly what a restore is, and a key pair that
 * cannot do it is worse than no backup at all.
 *
 * These are slow by design: scrypt at work factor 19 is about a second per
 * unwrap, which is the point of it.
 */

const PASSPHRASE = 'correct horse battery staple';

describe('the backup key pair (ruling R42)', () => {
  it('encrypts to the public key and decrypts with the passphrase-wrapped identity', async () => {
    const keys = await generateBackupKeys(PASSPHRASE);
    expect(keys.publicKey).toMatch(/^age1[0-9a-z]+$/);
    expect(keys.privateKeyEncrypted).toContain('-----BEGIN AGE ENCRYPTED FILE-----');

    // What the nightly job does: encrypt with the public key and no secret.
    const encrypter = new Encrypter();
    encrypter.addRecipient(keys.publicKey);
    const ciphertext = await encrypter.encrypt('a database, pretend');

    // What a restore does: passphrase → identity → plaintext.
    const identity = await unwrapIdentity(keys.privateKeyEncrypted, PASSPHRASE);
    expect(identity).toMatch(/^AGE-SECRET-KEY-1/);
    const decrypter = new Decrypter();
    decrypter.addIdentity(identity);
    expect(await decrypter.decrypt(ciphertext, 'text')).toBe('a database, pretend');
  }, 30_000);

  it('never returns the identity in the clear', async () => {
    const keys = await generateBackupKeys(PASSPHRASE);
    expect(JSON.stringify(keys)).not.toContain('AGE-SECRET-KEY');
  }, 30_000);

  it('fails cleanly on a wrong passphrase', async () => {
    const wrapped = await wrapIdentity('AGE-SECRET-KEY-1TEST', PASSPHRASE);
    await expect(unwrapIdentity(wrapped, 'not the passphrase')).rejects.toThrow();
  }, 30_000);

  it('gives every pair a different key', async () => {
    const [first, second] = await Promise.all([
      generateBackupKeys(PASSPHRASE),
      generateBackupKeys(PASSPHRASE),
    ]);
    expect(first.publicKey).not.toBe(second.publicKey);
  }, 30_000);
});

describe('the recovery file (ruling R42)', () => {
  const INPUT = {
    organizationName: 'Example Institute of Technology',
    publicKey: 'age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqsdummy',
    privateKeyEncrypted:
      '-----BEGIN AGE ENCRYPTED FILE-----\nY2lwaGVy\n-----END AGE ENCRYPTED FILE-----',
    schemaVersion: 4,
    appVersion: '0.1.0',
    createdAt: new Date('2026-09-20T09:00:00.000Z'),
  };

  it('is named for the day it was made', () => {
    expect(recoveryFileName(new Date(2026, 8, 20))).toBe('junction-recovery-20260920.txt');
    expect(recoveryFileName(new Date(2027, 0, 3))).toBe('junction-recovery-20270103.txt');
  });

  it('carries the public key, the wrapped identity and how to use them', () => {
    const text = renderRecoveryFile(INPUT);
    expect(text).toContain(INPUT.publicKey);
    expect(text).toContain('-----BEGIN AGE ENCRYPTED FILE-----');
    expect(text).toContain('Example Institute of Technology');
    expect(text).toContain('Schema      : 4');
    // The whole point of an open format: recovery without this application.
    expect(text).toContain('age --decrypt');
  });

  it('carries no plaintext key and no recovery code', () => {
    const text = renderRecoveryFile(INPUT);
    expect(text).not.toContain('AGE-SECRET-KEY-1');
    expect(text.toLowerCase()).toContain('does not contain');
  });
});
