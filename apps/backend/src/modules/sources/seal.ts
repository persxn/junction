import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Sealing a stored session at rest (ruling R76).
 *
 * R74 stored the professor's cookie "like an API key", and §6.2 calls API keys
 * low-value. A session is not one: it can register, edit a profile, submit. So
 * the value in the `settings` table is a sealed blob, and the key that opens it
 * lives outside the database — the shell creates it on first run, keeps it
 * DPAPI-protected in `<dataDir>\session-key.bin` and passes it to every backend
 * spawn beside the client secret.
 *
 * What that buys: a copy of `app.db`, a `VACUUM INTO` backup, an export, a
 * restore on another machine — none of them carry anything usable. Signing in
 * again is the cost, and R76 says that is by design.
 *
 * AES-256-GCM from `node:crypto`, so no dependency. The sealed form is
 * `ci1.<base64url(iv | tag | ciphertext)>`: one field, self-describing, and
 * versioned so a future change to the construction is a migration rather than a
 * guess about what the bytes mean.
 */

/** Prefix and version of the sealed form. */
export const SEAL_PREFIX = 'ci1.';

/** AES-256 takes 32 bytes; the shell sends them as 64 hex characters. */
export const KEY_BYTES = 32;

/** GCM's standard nonce length; anything else costs a key-derivation step. */
const IV_BYTES = 12;

/** GCM's authentication tag. */
const TAG_BYTES = 16;

/**
 * The key this process holds, or `undefined` when it has none.
 *
 * `undefined` is a supported state, not a failure: a standalone backend, server
 * mode, and a machine where the shell could not make a key all run without one.
 * They read the sources' public pages, which is what "no session" already meant.
 */
export type SessionKey = Buffer | undefined;

/** Parses `COMPINTEL_SESSION_KEY`; anything malformed is treated as absent. */
export function parseSessionKey(raw: string | undefined): SessionKey {
  if (raw === undefined || !/^[0-9a-f]{64}$/i.test(raw.trim())) {
    return undefined;
  }
  return Buffer.from(raw.trim(), 'hex');
}

/** Whether a stored value is in the sealed form (rather than pre-R76 plaintext). */
export function isSealed(value: string): boolean {
  return value.startsWith(SEAL_PREFIX);
}

/**
 * Seals a secret. Throws without a key, because a caller that reaches here has
 * already decided it has one — silently storing plaintext would be the exact
 * failure R76 exists to prevent.
 */
export function seal(key: SessionKey, plaintext: string): string {
  if (key === undefined) {
    throw new TypeError('This backend holds no session key, so nothing can be sealed (R76).');
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return SEAL_PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
}

/**
 * Opens a sealed secret, or returns `undefined`.
 *
 * Every way this can fail — no key, the wrong key, a truncated blob, a tampered
 * one — means the same thing to the caller: there is no usable session here.
 * Distinguishing them would only give a caller something to log.
 */
export function unseal(key: SessionKey, value: string): string | undefined {
  if (key === undefined || !isSealed(value)) {
    return undefined;
  }
  try {
    const raw = Buffer.from(value.slice(SEAL_PREFIX.length), 'base64url');
    if (raw.length <= IV_BYTES + TAG_BYTES) {
      return undefined;
    }
    const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, IV_BYTES));
    decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    const opened = Buffer.concat([
      decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)),
      decipher.final(),
    ]);
    return opened.toString('utf8');
  } catch {
    // GCM's tag check failing is the normal path for a wrong or tampered blob.
    return undefined;
  }
}

/** Whether two keys are the same, without leaking where they differ. */
export function sameKey(left: SessionKey, right: SessionKey): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  return left.length === right.length && timingSafeEqual(left, right);
}
