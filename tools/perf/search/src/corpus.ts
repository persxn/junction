import { createHash } from 'node:crypto';

import { Prng } from './prng.js';

/**
 * The synthetic perf corpus (§8.3: 20 000 events). A pure function of the seed:
 * no clock, no `Math.random`, no faker — so `corpusHash()` is the same on every
 * run and a slower number means slower code, not a different corpus.
 *
 * The shape is chosen to be *harder* than production, not prettier: long
 * descriptions, many shared title words (so FTS posting lists are long), a
 * spread of coordinates across India, and a few percent of hidden, merged-
 * looking and recurring rows that every query must skip.
 */

export const CORPUS_SEED = 0x15a_2026;
export const CORPUS_SIZE = 20_000;
/** Every date in the corpus is relative to this instant; the perf clock is fixed to it. */
export const CORPUS_EPOCH = Date.parse('2026-09-22T06:30:00.000Z');

const DAY = 86_400_000;

const PREFIXES = [
  'Smart',
  'National',
  'Global',
  'Winter',
  'Summer',
  'Open',
  'Code',
  'Hack',
  'Cyber',
  'Green',
  'Deep',
  'Quantum',
  'Rural',
  'Urban',
  'Campus',
  'India',
  'Future',
  'Bharat',
];
const THEMES = [
  'AI',
  'Machine Learning',
  'Blockchain',
  'Health',
  'Fintech',
  'Climate',
  'Robotics',
  'Security',
  'Space',
  'Agritech',
  'EdTech',
  'IoT',
  'Mobility',
  'Open Source',
  'Data',
  'Web3',
  'Energy',
  'Water',
];
const KINDS: readonly { word: string; type: string }[] = [
  { word: 'Hackathon', type: 'HACKATHON' },
  { word: 'Ideathon', type: 'IDEATHON' },
  { word: 'Innovation Challenge', type: 'INNOVATION_CHALLENGE' },
  { word: 'CTF', type: 'CTF' },
  { word: 'Coding Contest', type: 'CODING_CONTEST' },
  { word: 'Sprint', type: 'HACKATHON' },
];
const ORGANIZERS = [
  'IIT Madras',
  'IIT Bombay',
  'IIT Delhi',
  'NIT Trichy',
  'NIT Surathkal',
  'IIIT Hyderabad',
  'BITS Pilani',
  'Anna University',
  'AICTE',
  'MeitY',
  'Google Developer Groups',
  'Microsoft',
  'Infosys',
  'TCS',
  'CERT-In',
  'Devfolio Community',
  'IEEE Student Branch',
  'ACM Chapter',
  'Startup India',
  'NASSCOM',
];
const ORGANIZER_KINDS = [
  'IIT',
  'IIT',
  'IIT',
  'NIT',
  'NIT',
  'IIIT',
  'UNIVERSITY',
  'UNIVERSITY',
  'GOVERNMENT',
  'GOVERNMENT',
  'COMMUNITY',
  'CORPORATE',
  'CORPORATE',
  'CORPORATE',
  'GOVERNMENT',
  'PLATFORM',
  'COMMUNITY',
  'COMMUNITY',
  'GOVERNMENT',
  'CORPORATE',
];
const WORDS = [
  'build',
  'prototype',
  'teams',
  'students',
  'mentors',
  'prizes',
  'solve',
  'problem',
  'statement',
  'real',
  'world',
  'impact',
  'innovation',
  'judging',
  'round',
  'final',
  'submission',
  'deadline',
  'register',
  'online',
  'offline',
  'venue',
  'campus',
  'challenge',
  'security',
  'cloud',
  'api',
  'dataset',
  'model',
  'hardware',
  'software',
  'design',
  'pitch',
  'demo',
  'network',
  'learning',
  'research',
  'industry',
  'community',
  'open',
];
const CITIES: readonly { city: string; lat: number; lon: number }[] = [
  { city: 'Chennai', lat: 13.0827, lon: 80.2707 },
  { city: 'Bengaluru', lat: 12.9716, lon: 77.5946 },
  { city: 'Mumbai', lat: 19.076, lon: 72.8777 },
  { city: 'New Delhi', lat: 28.6139, lon: 77.209 },
  { city: 'Hyderabad', lat: 17.385, lon: 78.4867 },
  { city: 'Kolkata', lat: 22.5726, lon: 88.3639 },
  { city: 'Pune', lat: 18.5204, lon: 73.8567 },
  { city: 'Tiruchirappalli', lat: 10.7905, lon: 78.7047 },
  { city: 'Coimbatore', lat: 11.0168, lon: 76.9558 },
  { city: 'Kochi', lat: 9.9312, lon: 76.2673 },
  { city: 'Ahmedabad', lat: 23.0225, lon: 72.5714 },
  { city: 'Guwahati', lat: 26.1445, lon: 91.7362 },
];

export interface CorpusEvent {
  readonly index: number;
  readonly title: string;
  readonly eventType: string;
  readonly organizerName: string;
  readonly organizerKind: string;
  readonly descriptionMd: string;
  readonly mode: 'ONLINE' | 'OFFLINE' | 'HYBRID' | 'UNKNOWN';
  readonly city: string | null;
  readonly lat: number | null;
  readonly lon: number | null;
  readonly geoPrecision: 'CITY' | 'UNKNOWN';
  readonly registrationDeadlineAt: number | null;
  readonly startsAt: number | null;
  readonly endsAt: number | null;
  readonly teamMin: number | null;
  readonly teamMax: number | null;
  readonly feeKnown: boolean;
  readonly feeMinor: number | null;
  readonly prizeTotalMinor: number | null;
  readonly isRecurringRound: boolean;
  readonly visibility: 'VISIBLE' | 'POLICY_HIDDEN' | 'ADMIN_HIDDEN';
  readonly firstSeenAt: number;
  readonly sourceKey: string;
}

const SOURCES = ['ctftime', 'devfolio', 'unstop', 'clist', 'manual'];

export function generateCorpus(size = CORPUS_SIZE, seed = CORPUS_SEED): CorpusEvent[] {
  const rng = new Prng(seed);
  const out: CorpusEvent[] = [];
  for (let index = 0; index < size; index += 1) {
    const kind = rng.pick(KINDS);
    const organizerIndex = rng.int(0, ORGANIZERS.length - 1);
    const place = rng.pick(CITIES);
    const modeRoll = rng.next();
    const mode =
      modeRoll < 0.45
        ? 'ONLINE'
        : modeRoll < 0.8
          ? 'OFFLINE'
          : modeRoll < 0.95
            ? 'HYBRID'
            : 'UNKNOWN';
    const located = mode !== 'ONLINE' && rng.chance(0.9);
    const startOffset = rng.int(-60, 240);
    const startsAt = rng.chance(0.92) ? CORPUS_EPOCH + startOffset * DAY : null;
    const deadline = rng.chance(0.85) ? CORPUS_EPOCH + (startOffset - rng.int(1, 30)) * DAY : null;
    const teamKnown = rng.chance(0.7);
    const teamMin = teamKnown ? rng.int(1, 3) : null;
    const feeKnown = rng.chance(0.6);
    const words = Array.from({ length: rng.int(30, 120) }, () => rng.pick(WORDS));
    const visibilityRoll = rng.next();
    out.push({
      index,
      title: `${rng.pick(PREFIXES)} ${rng.pick(THEMES)} ${kind.word} ${String(2026 + rng.int(0, 1))}`,
      eventType: kind.type,
      organizerName: ORGANIZERS[organizerIndex] ?? 'Unknown',
      organizerKind: ORGANIZER_KINDS[organizerIndex] ?? 'OTHER',
      descriptionMd: words.join(' '),
      mode,
      city: located ? place.city : null,
      lat: located ? place.lat + (rng.next() - 0.5) * 0.2 : null,
      lon: located ? place.lon + (rng.next() - 0.5) * 0.2 : null,
      geoPrecision: located ? 'CITY' : 'UNKNOWN',
      registrationDeadlineAt: deadline,
      startsAt,
      endsAt: startsAt === null ? null : startsAt + rng.int(0, 3) * DAY,
      teamMin,
      teamMax: teamMin === null ? null : teamMin + rng.int(0, 4),
      feeKnown,
      feeMinor: feeKnown ? (rng.chance(0.7) ? 0 : rng.int(1, 20) * 10_000) : null,
      prizeTotalMinor: rng.chance(0.5) ? rng.int(1, 500) * 100_000 : null,
      isRecurringRound: kind.type === 'CODING_CONTEST' && rng.chance(0.5),
      visibility:
        visibilityRoll < 0.03
          ? 'POLICY_HIDDEN'
          : visibilityRoll < 0.05
            ? 'ADMIN_HIDDEN'
            : 'VISIBLE',
      firstSeenAt: CORPUS_EPOCH - rng.int(0, 365) * DAY,
      sourceKey: rng.pick(SOURCES),
    });
  }
  return out;
}

/** SHA-256 of the corpus as JSON — printed by the run so reproducibility is visible. */
export function corpusHash(corpus: readonly CorpusEvent[]): string {
  return createHash('sha256').update(JSON.stringify(corpus)).digest('hex');
}
