import { z } from 'zod';

/**
 * A UUIDv7 in canonical 8-4-4-4-12 lowercase hex form (RFC 9562, ARCHITECTURE.md
 * §6.1). The two fixed nibbles are checked as well: `7` is the version, and the
 * variant nibble must be one of 8/9/a/b (binary `10xx`).
 */
export const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Primary-key type for every row in the database (§6.1). */
export const Uuid7 = z.string().regex(UUID_V7_PATTERN, 'Expected a lowercase UUIDv7');
export type Uuid7 = z.infer<typeof Uuid7>;

/** The 48-bit Unix-millisecond timestamp a UUIDv7 was generated at. */
export function uuid7Timestamp(id: string): number {
  if (!UUID_V7_PATTERN.test(id)) {
    throw new TypeError(`Not a UUIDv7: ${id}`);
  }
  return Number.parseInt(id.slice(0, 8) + id.slice(9, 13), 16);
}
