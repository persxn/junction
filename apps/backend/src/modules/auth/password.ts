import { argon2 } from './argon2-binding.js';

/**
 * Password hashing (ARCHITECTURE.md §4.12, ADR-0010).
 *
 * Argon2**id**, not Argon2i or Argon2d: it is the variant that resists both a
 * GPU attack and a side-channel one, and it is what OWASP names for password
 * storage.
 *
 * §4.12 gives a floor (m >= 19 MiB, t = 2, p = 1) *and* a target (250-500 ms on
 * the host), and on this machine the floor costs **13.7 ms** — two orders of
 * magnitude short. The parameters below were chosen by measuring
 * (`pnpm --filter @compintel/backend argon:cost`); memory was raised first, as
 * memory-hardness is what makes a GPU attack expensive, and stopped at 128 MiB
 * because the pilot target is an 8 GB machine (§5). The remaining gap was closed
 * with iterations.
 *
 *   m=  19 MiB t=2   13.7 ms   (§4.12's floor / OWASP minimum)
 *   m= 128 MiB t=4  230.9 ms
 *   m= 128 MiB t=6  321.9 ms   <- chosen
 *   m= 256 MiB t=3  357.0 ms   (in band, but 256 MiB per login on 8 GB)
 */

/** Memory cost in KiB — 128 MiB, well above §4.12's 19 MiB floor. */
export const ARGON2_MEMORY_KIB = 131_072;
/** Time cost (iterations). */
export const ARGON2_TIME_COST = 6;
/** Parallelism; one lane, because the backend hashes one password at a time. */
export const ARGON2_PARALLELISM = 1;

/**
 * `Algorithm.Argon2id` from the library is an ambient `const enum`, which
 * `verbatimModuleSyntax` will not let us import; the numeric value is part of
 * the PHC format and is asserted in the tests, so writing it here is safe.
 */
const ARGON2ID = 2;

export interface Argon2Parameters {
  readonly algorithm: number;
  readonly memoryCost: number;
  readonly timeCost: number;
  readonly parallelism: number;
}

export const ARGON2_OPTIONS: Argon2Parameters = {
  algorithm: ARGON2ID,
  memoryCost: ARGON2_MEMORY_KIB,
  timeCost: ARGON2_TIME_COST,
  parallelism: ARGON2_PARALLELISM,
};

/**
 * A PHC string for this password. The salt is generated inside the library from
 * the OS CSPRNG, so the same password hashes differently every time; the hash
 * carries its own parameters, which is what lets them be raised later without a
 * migration.
 */
export async function hashPassword(
  password: string,
  options: Argon2Parameters = ARGON2_OPTIONS,
): Promise<string> {
  return argon2().hash(password, options);
}

/**
 * Whether a password matches a stored hash.
 *
 * No parameters are passed: a PHC string carries the ones it was made with, and
 * that is what makes raising the cost later a no-op for existing accounts.
 *
 * A malformed or truncated hash is `false`, never a throw: a corrupted row must
 * read as "wrong password" and be handled by the normal failure path, not turn
 * into a 500 that tells an attacker they found something interesting.
 */
export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  try {
    return await argon2().verify(storedHash, password);
  } catch {
    return false;
  }
}

/** The parameters a PHC string was produced with, for the cost assertions. */
export function parsePhcParameters(phc: string): Record<string, string> | undefined {
  const parts = phc.split('$');
  // $argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>
  const parameters = parts[3];
  if (parts[1] !== 'argon2id' || parameters === undefined) {
    return undefined;
  }
  return Object.fromEntries(
    parameters.split(',').map((pair) => {
      const [key, value] = pair.split('=');
      return [key ?? '', value ?? ''];
    }),
  );
}
