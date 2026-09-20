import { randomFillSync } from 'node:crypto';

import type { Uuid7 } from '@compintel/contracts';

/** Largest value `rand_a` can hold: 12 bits of monotonic counter. */
const COUNTER_MAX = 0xfff;

/** 48 bits of Unix milliseconds, the last timestamp a v7 id can carry. */
const MAX_TIMESTAMP_MS = 0xffffffffffff;

const HEX: string[] = Array.from({ length: 256 }, (_unused, index) =>
  index.toString(16).padStart(2, '0'),
);

function format(bytes: Uint8Array): Uuid7 {
  let out = '';
  for (let index = 0; index < 16; index += 1) {
    if (index === 4 || index === 6 || index === 8 || index === 10) {
      out += '-';
    }
    out += HEX[bytes[index] ?? 0];
  }
  return out;
}

export type Uuid7Generator = () => Uuid7;

/**
 * RFC 9562 UUIDv7: 48-bit Unix-ms timestamp, version 7, `rand_a` used as a
 * monotonic counter inside one millisecond, variant `10`, then 62 random bits
 * (ARCHITECTURE.md §6.1, ruling A16 — in-house, no dependency).
 *
 * Two properties matter for primary keys and both are tested:
 *   - ids minted in the same millisecond still sort in generation order,
 *     because the counter increments and, on overflow, borrows a millisecond
 *     from the future;
 *   - the clock going backwards (NTP correction, DST-agnostic but still real)
 *     never produces an id that sorts before one already handed out, because
 *     the generator keeps its own high-water mark.
 */
export function createUuid7(clock: () => number = Date.now): Uuid7Generator {
  const bytes = new Uint8Array(16);
  let lastMs = -1;
  let counter = 0;

  return (): Uuid7 => {
    const now = clock();
    if (!Number.isFinite(now) || now < 0 || now > MAX_TIMESTAMP_MS) {
      throw new RangeError(`Clock returned a timestamp outside the UUIDv7 range: ${String(now)}`);
    }

    if (now > lastMs) {
      lastMs = Math.floor(now);
      counter = 0;
    } else {
      // Same millisecond, or the clock moved backwards: stay on the high-water
      // mark and keep counting so ordering never regresses.
      counter += 1;
      if (counter > COUNTER_MAX) {
        lastMs += 1;
        counter = 0;
      }
    }

    const timestamp = lastMs;
    bytes[0] = Math.floor(timestamp / 0x10000000000) & 0xff;
    bytes[1] = Math.floor(timestamp / 0x100000000) & 0xff;
    bytes[2] = Math.floor(timestamp / 0x1000000) & 0xff;
    bytes[3] = Math.floor(timestamp / 0x10000) & 0xff;
    bytes[4] = Math.floor(timestamp / 0x100) & 0xff;
    bytes[5] = timestamp & 0xff;

    // Version 7 in the high nibble, the counter's top 4 bits in the low nibble.
    bytes[6] = 0x70 | ((counter >>> 8) & 0x0f);
    bytes[7] = counter & 0xff;

    randomFillSync(bytes, 8, 8);
    // Variant 10xx in the two most significant bits of byte 8.
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

    return format(bytes);
  };
}

/** The process-wide generator. Every primary key in the database comes from here. */
export const uuid7: Uuid7Generator = createUuid7();
