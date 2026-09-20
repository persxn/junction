import { hash } from '@node-rs/argon2';

/**
 * Measures what Argon2id costs on this machine (§4.12, ADR-0010: "tuned to
 * ~250-500 ms on the host").
 *
 * Run it with `pnpm --filter @compintel/backend argon:cost`. It is a tool, not a
 * test: the right parameters depend on the machine, and a unit test that
 * asserted a wall-clock band would fail on a slow laptop and on a fast one for
 * opposite reasons.
 */

const ARGON2ID = 2;
const PASSWORD = 'correct horse battery staple';
const ROUNDS = 5;

interface Candidate {
  readonly memoryCost: number;
  readonly timeCost: number;
  readonly parallelism: number;
}

const CANDIDATES: readonly Candidate[] = [
  // §4.12's floor, which is also OWASP's minimum recommendation.
  { memoryCost: 19_456, timeCost: 2, parallelism: 1 },
  { memoryCost: 65_536, timeCost: 3, parallelism: 1 },
  { memoryCost: 65_536, timeCost: 6, parallelism: 1 },
  { memoryCost: 131_072, timeCost: 3, parallelism: 1 },
  { memoryCost: 131_072, timeCost: 4, parallelism: 1 },
  { memoryCost: 131_072, timeCost: 6, parallelism: 1 },
  { memoryCost: 262_144, timeCost: 3, parallelism: 1 },
];

async function measure(candidate: Candidate): Promise<number> {
  const timings: number[] = [];
  for (let round = 0; round < ROUNDS; round += 1) {
    const started = process.hrtime.bigint();
    await hash(PASSWORD, { algorithm: ARGON2ID, ...candidate });
    timings.push(Number(process.hrtime.bigint() - started) / 1e6);
  }
  timings.sort((a, b) => a - b);
  return timings[Math.floor(timings.length / 2)] ?? 0;
}

process.stdout.write(`argon2id, median of ${String(ROUNDS)} hashes, target 250-500 ms\n`);
for (const candidate of CANDIDATES) {
  const ms = await measure(candidate);
  const memoryMib = (candidate.memoryCost / 1024).toFixed(0);
  const band = ms >= 250 && ms <= 500 ? '  <- in band' : '';
  process.stdout.write(
    `  m=${memoryMib.padStart(4)} MiB  t=${String(candidate.timeCost)}  p=${String(candidate.parallelism)}  ` +
      `${ms.toFixed(1).padStart(7)} ms${band}\n`,
  );
}
