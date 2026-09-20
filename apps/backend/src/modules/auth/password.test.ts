import { describe, expect, it } from 'vitest';

import {
  ARGON2_MEMORY_KIB,
  ARGON2_PARALLELISM,
  ARGON2_TIME_COST,
  hashPassword,
  parsePhcParameters,
  verifyPassword,
} from './password.js';

/**
 * Argon2id (§4.12, ADR-0010). The cost is real, so these tests are the slowest
 * in the suite by design: hashing that finishes instantly is hashing that is not
 * protecting anything.
 */

const PASSWORD = 'correct horse battery staple';

describe('hashPassword', () => {
  it('produces an argon2id PHC string, not the password', async () => {
    const phc = await hashPassword(PASSWORD);
    expect(phc.startsWith('$argon2id$')).toBe(true);
    expect(phc).not.toContain(PASSWORD);
  });

  it('uses the §4.12 parameters', async () => {
    const parameters = parsePhcParameters(await hashPassword(PASSWORD));
    expect(parameters).toStrictEqual({
      m: String(ARGON2_MEMORY_KIB),
      t: String(ARGON2_TIME_COST),
      p: String(ARGON2_PARALLELISM),
    });
    // The spec's floor is 19 MiB, t = 2, p = 1.
    expect(ARGON2_MEMORY_KIB).toBeGreaterThanOrEqual(19 * 1024);
    expect(ARGON2_TIME_COST).toBeGreaterThanOrEqual(2);
  });

  it('salts, so the same password hashes differently every time', async () => {
    const [a, b] = await Promise.all([hashPassword(PASSWORD), hashPassword(PASSWORD)]);
    expect(a).not.toBe(b);
    // …and both still verify.
    await expect(verifyPassword(a, PASSWORD)).resolves.toBe(true);
    await expect(verifyPassword(b, PASSWORD)).resolves.toBe(true);
  });
});

describe('verifyPassword', () => {
  it('accepts the right password and refuses a wrong one', async () => {
    const phc = await hashPassword(PASSWORD);
    await expect(verifyPassword(phc, PASSWORD)).resolves.toBe(true);
    await expect(verifyPassword(phc, 'correct horse battery stapl')).resolves.toBe(false);
    await expect(verifyPassword(phc, '')).resolves.toBe(false);
  });

  it('is case- and whitespace-sensitive', async () => {
    const phc = await hashPassword(PASSWORD);
    await expect(verifyPassword(phc, PASSWORD.toUpperCase())).resolves.toBe(false);
    await expect(verifyPassword(phc, ` ${PASSWORD}`)).resolves.toBe(false);
  });

  it('reads a corrupt hash as "wrong password", not as a crash', async () => {
    // A truncated or foreign row must take the normal failure path; a 500 would
    // tell an attacker they had found something interesting.
    for (const broken of ['', 'not-a-hash', '$argon2id$v=19$m=19456,t=2,p=1$AAA', '$2b$10$abc']) {
      await expect(verifyPassword(broken, PASSWORD)).resolves.toBe(false);
    }
  });
});

describe('parsePhcParameters', () => {
  it('returns undefined for something that is not argon2id', () => {
    expect(parsePhcParameters('$argon2i$v=19$m=1,t=1,p=1$a$b')).toBeUndefined();
    expect(parsePhcParameters('nonsense')).toBeUndefined();
  });
});

describe('the measured cost (§4.12: 250-500 ms on the host)', () => {
  it('is reported, and is not instant', async () => {
    const started = process.hrtime.bigint();
    await hashPassword(PASSWORD);
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    process.stdout.write(
      `      argon2id m=${String(ARGON2_MEMORY_KIB)}KiB t=${String(ARGON2_TIME_COST)} p=${String(ARGON2_PARALLELISM)} -> ${ms.toFixed(1)} ms\n`,
    );
    // A floor only. The spec's 250-500 ms band is a tuning target for the host,
    // not something a CI machine or a busy laptop can be held to, and a test
    // that fails because the machine was fast is a test that gets deleted.
    expect(ms).toBeGreaterThan(1);
  });
});
