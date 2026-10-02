import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { Geocoder, openGazetteer } from '@compintel/backend';

/**
 * Geocodes a fixed list of places against one gazetteer file and writes what
 * each resolved to — so a change to the build's filter (ruling R82) can be
 * shown as a before/after diff rather than asserted.
 *
 * The list is every city in `resources/institutions/seed.json`, asked three
 * ways: with its state, with only the country, and alone. That is WP-08b's
 * geocoding ground truth — the places this product is known to care about —
 * and the three forms exercise rungs 3 and 4 and R55's population tie-break.
 * The institution rung is deliberately off (no seed is loaded), so every answer
 * comes from the gazetteer.
 *
 * Usage:
 *   tsx src/probe.ts --db <gazetteer.db> --out <result.json>
 *   tsx src/probe.ts --compare <before.json> <after.json>
 */

interface Probe {
  readonly label: string;
  readonly city: string;
  readonly state?: string;
  readonly countryCode?: string;
}

interface Answer {
  readonly label: string;
  readonly precision: string;
  readonly city: string | null;
  readonly state: string | null;
  readonly warnings: number;
}

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');

function probes(): Probe[] {
  const seed = JSON.parse(
    readFileSync(path.join(repoRoot, 'resources', 'institutions', 'seed.json'), 'utf8'),
  ) as { institutions: { city?: string; state?: string; countryCode?: string }[] };
  const seen = new Set<string>();
  const list: Probe[] = [];
  for (const row of seed.institutions) {
    if (row.city === undefined || seen.has(`${row.city}|${row.state ?? ''}`)) {
      continue;
    }
    seen.add(`${row.city}|${row.state ?? ''}`);
    const country = row.countryCode ?? 'IN';
    if (row.state !== undefined) {
      list.push({
        label: `${row.city}, ${row.state}`,
        city: row.city,
        state: row.state,
        countryCode: country,
      });
    }
    list.push({ label: `${row.city}, ${country}`, city: row.city, countryCode: country });
    list.push({ label: row.city, city: row.city });
  }
  return list;
}

function run(db: string, out: string): void {
  // A no-op logger: this tool prints its own summary, and adds no dependency.
  const quiet = { warn: () => undefined, info: () => undefined, debug: () => undefined };
  type Options = Parameters<typeof openGazetteer>[1];
  const gazetteer = openGazetteer(db, { logger: quiet as unknown as Options['logger'] });
  const geocoder = new Geocoder({ gazetteer, institutions: [] });
  const answers: Answer[] = probes().map((probe) => {
    const result = geocoder.resolve({
      city: probe.city,
      ...(probe.state === undefined ? {} : { state: probe.state }),
      ...(probe.countryCode === undefined ? {} : { countryCode: probe.countryCode }),
    });
    return {
      label: probe.label,
      precision: result.geoPrecision,
      city: result.city ?? null,
      state: result.state ?? null,
      warnings: result.warnings.length,
    };
  });
  gazetteer.close();
  writeFileSync(out, `${JSON.stringify(answers, null, 2)}\n`, 'utf8');
  const counts = new Map<string, number>();
  for (const answer of answers) {
    counts.set(answer.precision, (counts.get(answer.precision) ?? 0) + 1);
  }
  process.stdout.write(
    `${String(answers.length)} probes: ${[...counts].map(([k, v]) => `${k} ${String(v)}`).join(' · ')}\n`,
  );
}

function compare(beforeFile: string, afterFile: string): void {
  const before = JSON.parse(readFileSync(beforeFile, 'utf8')) as Answer[];
  const after = new Map(
    (JSON.parse(readFileSync(afterFile, 'utf8')) as Answer[]).map((a) => [a.label, a]),
  );
  let changed = 0;
  for (const old of before) {
    const now = after.get(old.label);
    if (now === undefined || (now.precision === old.precision && now.city === old.city)) {
      continue;
    }
    changed += 1;
    process.stdout.write(
      `${old.label}\t${old.precision}${old.city === null ? '' : ` (${old.city})`} → ${now.precision}${now.city === null ? '' : ` (${now.city})`}\n`,
    );
  }
  process.stdout.write(`${String(changed)} of ${String(before.length)} probes changed\n`);
}

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: { db: { type: 'string' }, out: { type: 'string' }, compare: { type: 'boolean' } },
  allowPositionals: true,
  strict: true,
});
if (values.compare === true) {
  const [beforeFile, afterFile] = positionals;
  if (beforeFile === undefined || afterFile === undefined) {
    throw new Error('--compare needs two result files');
  }
  compare(beforeFile, afterFile);
} else {
  if (values.db === undefined || values.out === undefined) {
    throw new Error('--db and --out are required');
  }
  run(values.db, values.out);
}
