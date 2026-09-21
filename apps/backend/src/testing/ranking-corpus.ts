import type { EventMode, EventType, Visibility } from '@compintel/contracts';

import type { Principal } from '../modules/auth/types.js';
import { openSearchHarness, SEARCH_NOW, type SearchHarness } from './search.js';

/**
 * A small, varied, *seeded* corpus for WP-15b's ranking and facet tests: every
 * field a boost or a facet reads takes known, unknown and edge values, a few
 * events are hidden each way §7.4 hides them, and the starter taxonomy has
 * classified the lot. Deterministic (a fixed-seed PRNG), so a failing property
 * reproduces.
 */

export const CAMPUS = { lat: 13.0827, lon: 80.2707 }; // Chennai
const DAY = 86_400_000;

function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const THEMES = [
  'AI',
  'Blockchain',
  'CTF',
  'Robotics',
  'Web Development',
  'Open Source',
  'Datathon',
  'IoT',
  'Mobile App',
  'Design',
];
const KINDS = ['Hackathon', 'Challenge', 'Summit', 'Jam'];
const TYPES: EventType[] = [
  'HACKATHON',
  'IDEATHON',
  'INNOVATION_CHALLENGE',
  'CTF',
  'CODING_CONTEST',
];
const MODES: EventMode[] = ['ONLINE', 'OFFLINE', 'HYBRID', 'UNKNOWN'];
const SOURCES = ['ctftime', 'clist', 'devfolio', 'unstop'];
const TAGS = ['Blockchain', 'AI', 'Design', 'Web', 'jeopardy'];

export interface RankingCorpus {
  readonly h: SearchHarness;
  readonly professor: Principal;
  /** Ids of the events hidden by policy, by an admin, merged away, or hidden by `professor`. */
  readonly hidden: { policy: string; admin: string; merged: string; user: string };
  readonly visibleCount: number;
}

export async function openRankingCorpus(size = 60): Promise<RankingCorpus> {
  const h = openSearchHarness();
  h.campus(CAMPUS.lat, CAMPUS.lon);
  h.seedCategories();
  const random = prng(1509);
  const now = Date.parse(SEARCH_NOW);
  const pick = <T>(values: readonly T[]): T => values[Math.floor(random() * values.length)] as T;
  const maybe = <T>(chance: number, value: () => T): T | null =>
    random() < chance ? value() : null;

  const ids: string[] = [];
  for (let index = 0; index < size; index += 1) {
    const mode = pick(MODES);
    const located = mode !== 'ONLINE' && random() < 0.75;
    const km = random() * 900;
    const angle = random() * 2 * Math.PI;
    const lat = CAMPUS.lat + (km / 111) * Math.sin(angle);
    const lon = CAMPUS.lon + (km / (111 * Math.cos((lat * Math.PI) / 180))) * Math.cos(angle);
    const deadline = maybe(0.8, () => now + Math.round((random() * 70 - 10) * DAY));
    const teamMin = maybe(0.6, () => 1 + Math.floor(random() * 3));
    const id = h.add({
      title: `${pick(THEMES)} ${pick(KINDS)} ${String(index)}`,
      eventType: pick(TYPES),
      mode,
      lat: located ? lat : null,
      lon: located ? lon : null,
      geoPrecision: located ? 'CITY' : 'UNKNOWN',
      registrationDeadlineAt: deadline,
      registrationDeadlinePrecision: deadline === null ? 'UNKNOWN' : 'DATE',
      registrationOpensAt: maybe(0.1, () => now + 5 * DAY),
      startsAt: deadline === null ? null : deadline + 5 * DAY,
      datePrecision: deadline === null ? 'UNKNOWN' : 'DATE',
      teamMin,
      teamMax: teamMin === null ? maybe(0.3, () => 4) : teamMin + Math.floor(random() * 4),
      hasConflicts: random() < 0.3,
      firstSeenAt: now - Math.round(random() * 40 * DAY),
      prizeTotalMinor: maybe(0.4, () => Math.round(random() * 100) * 100_000),
      prizeCurrency: 'INR',
    });
    h.addSource(id, pick(SOURCES), random() < 0.5 ? [pick(TAGS)] : undefined);
    ids.push(id);
  }

  const hide = (visibility: Visibility, extra: Record<string, unknown> = {}): string =>
    h.add({
      title: `Hidden ${visibility} Hackathon`,
      eventType: 'OTHER',
      mode: 'OFFLINE',
      lat: CAMPUS.lat,
      lon: CAMPUS.lon,
      geoPrecision: 'CITY',
      registrationDeadlineAt: now + 3 * DAY,
      registrationDeadlinePrecision: 'DATE',
      visibility,
      ...extra,
    });
  const policy = hide('POLICY_HIDDEN');
  const admin = hide('ADMIN_HIDDEN');
  const merged = hide('MERGED', { mergedIntoEventId: ids[0] });
  const user = hide('VISIBLE');
  const professor = h.user('PROFESSOR');
  h.database.db.raw
    .prepare('INSERT INTO event_user_state (user_id, event_id, is_hidden) VALUES (?, ?, 1)')
    .run(professor.id, user);

  await h.classifyAll();
  return { h, professor, hidden: { policy, admin, merged, user }, visibleCount: size + 1 };
}
