import { randomBytes } from 'node:crypto';

/**
 * The one-time admin recovery code (ruling R41).
 *
 * 32 random bytes in Crockford base32, grouped in fives. Crockford rather than
 * RFC 4648 because a person reads this off a printout and types it back: the
 * alphabet has no I, L, O or U, so there is no 1/I and no 0/O to get wrong, and
 * decoding folds the confusable characters back anyway.
 *
 * The code is shown once and stored only as an Argon2id hash, exactly like a
 * password — it *is* a password, one that gets an administrator back in when
 * every admin account is locked out.
 */

/** Crockford base32, without the check symbols (§ "Symbols" in the spec). */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** How many random bytes back the code (R41). */
export const RECOVERY_CODE_BYTES = 32;

/** Characters per dash-separated group. */
const GROUP = 5;

/** What a user typing the code might reasonably substitute. */
const FOLD: Readonly<Record<string, string>> = { I: '1', L: '1', O: '0', U: 'V' };

function encodeCrockford(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

function group(code: string): string {
  const groups: string[] = [];
  for (let index = 0; index < code.length; index += GROUP) {
    groups.push(code.slice(index, index + GROUP));
  }
  return groups.join('-');
}

/** A fresh code, formatted the way it is shown and printed. */
export function generateRecoveryCode(random: (size: number) => Uint8Array = randomBytes): string {
  return group(encodeCrockford(random(RECOVERY_CODE_BYTES)));
}

/**
 * The canonical form a code hashes as: upper case, no dashes or spaces, with the
 * confusable characters folded. Typing `l` for `1` still gets you in.
 */
export function normalizeRecoveryCode(code: string): string {
  return [...code.toUpperCase().replace(/[^0-9A-Z]/g, '')]
    .map((character) => FOLD[character] ?? character)
    .join('');
}
