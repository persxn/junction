import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Session tokens (ruling R33, §4.12).
 *
 * The token is opaque: 256 bits from the OS CSPRNG, with no structure to parse
 * and nothing to forge. Only its SHA-256 is stored, so a stolen copy of the
 * database cannot be replayed as a session — and, unlike a password, a fast hash
 * is the right choice here, because a 256-bit random value has nothing to
 * brute-force.
 */

/** 32 bytes = 256 bits, per §4.12. */
export const SESSION_TOKEN_BYTES = 32;

/** Absolute lifetime of a session, never extended (R33). */
export const ABSOLUTE_SESSION_MS = 12 * 60 * 60 * 1000;

/**
 * How stale `last_seen_at` / `idle_expires_at` may get before a request is
 * allowed to write them (R33). Without it, a screen polling every few seconds
 * would turn every read into a write on a single SQLite file.
 */
export const SESSION_REFRESH_INTERVAL_MS = 60_000;

export type RandomBytes = (size: number) => Buffer;

/** A fresh opaque token, hex-encoded. */
export function generateSessionToken(random: RandomBytes = randomBytes): string {
  return random(SESSION_TOKEN_BYTES).toString('hex');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Constant-time comparison of two hex hashes, for code paths that compare them. */
export function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

/** Pulls the bearer token out of an `Authorization` header, if there is one. */
export function bearerToken(header: string | undefined): string | undefined {
  if (header === undefined) {
    return undefined;
  }
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1];
}
