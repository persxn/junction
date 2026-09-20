import { DEFAULT_GEOGRAPHY_POLICY, type EventCandidate } from '@compintel/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { normalizeCandidate } from '../../domain/normalize/index.js';
import { AuditLog } from '../../platform/audit.js';
import { SettingsStore } from '../../platform/settings.js';
import { fixedClock } from '../../platform/time.js';
import { openMigratedDatabase, type MigratedDatabase } from '../../testing/database.js';
import { openMiniGazetteer } from '../../testing/gazetteer.js';
import { Geocoder } from '../geo/geocoder.js';
import { loadInstitutions, seedInstitutions } from '../geo/seed.js';
import { EVENT_TYPE_POLICY, GEOGRAPHY_POLICY } from '../geo/settings.js';
import { EventsRepository } from './repository.js';
import { EventsService } from './service.js';

/**
 * **The §19 acceptance criterion for WP-08b.**
 *
 * An in-person event in Seoul is not what a Kolkata department is looking for,
 * and the geography policy hides it. The thing worth testing is not that it
 * disappears — it is that it was **stored anyway** (R57), so that the day
 * somebody decides Korea is interesting, one settings change brings it back
 * without waiting for CTFtime to list it again.
 *
 * Everything here runs against a real migrated database and the committed mini
 * gazetteer. No network: a spy on `fetch` proves it.
 */

const NOW = '2026-09-20T09:00:00.000Z';
const clock = fixedClock(NOW);

let database: MigratedDatabase | undefined;
let gazetteerHandle: { close: () => void } | undefined;

afterEach(() => {
  gazetteerHandle?.close();
  gazetteerHandle = undefined;
  database?.close();
  database = undefined;
});

function harness(): {
  service: EventsService;
  repository: EventsRepository;
  settings: SettingsStore;
  db: MigratedDatabase;
} {
  database = openMigratedDatabase(undefined, 'events');
  const settings = new SettingsStore(database.db, { clock });
  const audit = new AuditLog(database.db, { clock });
  seedInstitutions(database.db, audit, { clock });

  const gazetteer = openMiniGazetteer();
  gazetteerHandle = gazetteer;
  const geocoder = new Geocoder({
    gazetteer,
    institutions: loadInstitutions(database.db),
  });
  const repository = new EventsRepository(database.db);
  return {
    service: new EventsService({ repository, geocoder, settings, audit, clock }),
    repository,
    settings,
    db: database,
  };
}

/** A CTFtime-shaped in-person event in Seoul, as the fixture describes it. */
function seoulCandidate(): EventCandidate {
  return normalizeCandidate(
    {
      sourceKey: 'ctftime',
      externalKey: '3417',
      url: 'https://ctftime.org/event/3417',
      title: 'SCAN 2026 Finals',
      sourceType: 'ctf',
      description: 'An in-person CTF final in Seoul, Korea.',
      mode: 'OFFLINE',
      place: { venueName: 'Seoul', city: 'Seoul', countryCode: 'KR' },
      startsAt: { structured: '2026-11-20T09:00:00Z' },
      endsAt: { structured: '2026-11-22T18:00:00Z' },
    },
    { clock, sourceTimezone: 'UTC', sourceEventType: 'CTF' },
  ).candidate;
}

/** A quiz — out of scope by the event-type policy (D-31). */
function quizCandidate(): EventCandidate {
  return normalizeCandidate(
    {
      sourceKey: 'testsource',
      externalKey: 'quiz-1',
      url: 'https://example.org/quiz',
      title: 'Annual Business Case Competition',
      description: 'A case competition for management students.',
      mode: 'OFFLINE',
      place: { city: 'Mumbai', countryCode: 'IN' },
      startsAt: { structured: '2026-11-20' },
    },
    { clock, sourceTimezone: 'Asia/Kolkata' },
  ).candidate;
}

describe('the §19 criterion: a policy hides, it never drops', () => {
  it('stores an in-person Seoul event as POLICY_HIDDEN with a reason', () => {
    const { service, db } = harness();
    const result = service.createEventFromCandidate(seoulCandidate(), {
      sourceRecordId: 'rec-1',
    });

    expect(result.visibility).toBe('POLICY_HIDDEN');
    expect(result.policyReason).toBe('IN_PERSON_OUTSIDE_ALLOWED_COUNTRIES');

    // A raw SELECT, deliberately: the row must be in the table, not merely
    // absent from a filtered read.
    const row = db.db.raw
      .prepare('select id, visibility, policy_reason, country_code, title from events where id = ?')
      .get(result.eventId) as {
      visibility: string;
      policy_reason: string;
      country_code: string;
      title: string;
    };
    expect(row.visibility).toBe('POLICY_HIDDEN');
    expect(row.policy_reason).toBe('IN_PERSON_OUTSIDE_ALLOWED_COUNTRIES');
    expect(row.country_code).toBe('KR');
    expect(row.title).toBe('SCAN 2026 Finals');
  });

  it('keeps it out of every read path', () => {
    const { service, repository } = harness();
    const result = service.createEventFromCandidate(seoulCandidate(), {
      sourceRecordId: 'rec-1',
    });

    expect(repository.listVisibleEvents()).toStrictEqual([]);
    expect(repository.getVisibleEventById(result.eventId)).toBeUndefined();
    expect(repository.countVisibleEvents()).toBe(0);
    expect(repository.visibleEvents()).toStrictEqual([]);
    // But it is there.
    expect(repository.allEvents()).toHaveLength(1);
  });

  it('makes it visible when the policy widens — with no re-scrape', () => {
    const { service, repository, settings } = harness();
    const result = service.createEventFromCandidate(seoulCandidate(), {
      sourceRecordId: 'rec-1',
    });
    expect(repository.countVisibleEvents()).toBe(0);

    settings.set(GEOGRAPHY_POLICY, {
      ...DEFAULT_GEOGRAPHY_POLICY,
      inPerson: { allowCountries: ['IN', 'KR'] },
    });
    const changed = service.reapplyPolicies();

    expect(changed.changed).toBe(1);
    expect(repository.countVisibleEvents()).toBe(1);
    expect(repository.getVisibleEventById(result.eventId)?.title).toBe('SCAN 2026 Finals');
    expect(repository.getVisibleEventById(result.eventId)?.policyReason).toBeNull();
  });

  it('hides an out-of-scope event type the same way', () => {
    const { service, repository, db } = harness();
    const result = service.createEventFromCandidate(quizCandidate(), {
      sourceRecordId: 'rec-2',
    });

    expect(result.visibility).toBe('POLICY_HIDDEN');
    expect(result.policyReason).toBe('EVENT_TYPE_OUT_OF_SCOPE');
    expect(repository.countVisibleEvents()).toBe(0);
    expect((db.db.raw.prepare('select count(*) as n from events').get() as { n: number }).n).toBe(
      1,
    );
  });

  it('widening the event-type policy brings it back too', () => {
    const { service, repository, settings } = harness();
    service.createEventFromCandidate(quizCandidate(), { sourceRecordId: 'rec-2' });

    settings.set(EVENT_TYPE_POLICY, {
      allowedTypes: [
        'HACKATHON',
        'IDEATHON',
        'INNOVATION_CHALLENGE',
        'CTF',
        'CODING_CONTEST',
        'OTHER',
      ],
      unknownType: 'SHOW_FLAGGED',
    });
    service.reapplyPolicies();

    expect(repository.countVisibleEvents()).toBe(1);
  });

  it('stores an Indian hackathon as visible', () => {
    const { service, repository } = harness();
    const candidate = normalizeCandidate(
      {
        sourceKey: 'devfolio',
        externalKey: 'hack-1',
        url: 'https://devfolio.co/hack',
        title: 'Recursive Hackathon 2026',
        sourceType: 'hackathon',
        mode: 'OFFLINE',
        place: {
          venueName: 'Guru Nanak Institute of Technology',
          city: 'Kolkata',
          countryCode: 'IN',
        },
        startsAt: { structured: '2026-10-08' },
        teamSizeText: 'Teams of 2 to 4',
        feeText: 'Free',
      },
      { clock, sourceTimezone: 'Asia/Kolkata' },
    ).candidate;

    const result = service.createEventFromCandidate(candidate, { sourceRecordId: 'rec-3' });
    expect(result.visibility).toBe('VISIBLE');
    expect(repository.countVisibleEvents()).toBe(1);

    const stored = repository.getVisibleEventById(result.eventId);
    expect(stored?.eventType).toBe('HACKATHON');
    expect(stored?.countryCode).toBe('IN');
    expect(stored?.teamMin).toBe(2);
    expect(stored?.teamMax).toBe(4);
    expect(stored?.feeKnown).toBe(true);
    expect(stored?.feeMinor).toBe(0);
    // The venue names a seeded institution, so it resolved to that campus.
    expect(stored?.hostInstitutionId).not.toBeNull();
  });
});

describe('what the write path records alongside the event', () => {
  it('writes the registration deadline as an event_deadlines row', () => {
    const { service, repository } = harness();
    const candidate = normalizeCandidate(
      {
        sourceKey: 'testsource',
        externalKey: 'e-1',
        url: 'https://example.org/e/1',
        title: 'HackX 2026',
        sourceType: 'hackathon',
        place: { city: 'Pune', countryCode: 'IN' },
        registrationDeadlineAt: { structured: '2026-10-05' },
      },
      { clock, sourceTimezone: 'Asia/Kolkata' },
    ).candidate;

    const result = service.createEventFromCandidate(candidate, { sourceRecordId: 'rec-4' });
    const deadlines = repository.deadlinesOf(result.eventId);
    expect(deadlines).toHaveLength(1);
    expect(deadlines[0]?.kind).toBe('REGISTRATION');
    expect(deadlines[0]?.precision).toBe('DATE');
    // R49: the provenance column holds the id with no foreign key behind it.
    expect(deadlines[0]?.sourceRecordId).toBe('rec-4');
  });

  it('writes one provenance claim per claimed field', () => {
    const { service, repository } = harness();
    const result = service.createEventFromCandidate(seoulCandidate(), {
      sourceRecordId: 'rec-1',
    });
    const claims = repository.claimsOf(result.eventId);
    expect(claims.length).toBeGreaterThan(5);
    expect(claims.every((claim) => claim.sourceRecordId === 'rec-1')).toBe(true);
    expect(claims.every((claim) => claim.isSelected)).toBe(true);
    expect(claims.map((claim) => claim.field)).toContain('countryCode');
  });

  it('writes one audit row, in the same transaction as the event', () => {
    const { service, db } = harness();
    const audit = new AuditLog(db.db);
    const before = audit.all().length;
    service.createEventFromCandidate(seoulCandidate(), { sourceRecordId: 'rec-1' });

    const rows = audit.all();
    expect(rows.length).toBe(before + 1);
    const last = rows.at(-1);
    expect(last?.action).toBe('event.created');
    expect(last?.actorKind).toBe('SYSTEM');
    expect(last?.summary).toContain('hidden by policy');
    expect(audit.verifyChain().ok).toBe(true);
  });

  it('gives a sparse event a lower quality score than a complete one', () => {
    const { service, repository } = harness();
    const sparse = normalizeCandidate(
      {
        sourceKey: 'testsource',
        externalKey: 'sparse',
        url: 'https://example.org/sparse',
        title: 'Mystery Hackathon',
        sourceType: 'hackathon',
      },
      { clock, sourceTimezone: 'Asia/Kolkata' },
    ).candidate;
    const complete = normalizeCandidate(
      {
        sourceKey: 'testsource',
        externalKey: 'complete',
        url: 'https://example.org/complete',
        title: 'Complete Hackathon',
        sourceType: 'hackathon',
        organizerName: 'IIT Bombay',
        description: '<p>Everything is stated.</p>',
        mode: 'OFFLINE',
        place: { city: 'Mumbai', countryCode: 'IN' },
        startsAt: { structured: '2026-11-01' },
        registrationDeadlineAt: { structured: '2026-10-20' },
        teamSizeText: 'Teams of 2 to 4',
        feeText: 'Free',
        officialUrl: 'https://example.org/complete',
      },
      { clock, sourceTimezone: 'Asia/Kolkata' },
    ).candidate;

    const a = service.createEventFromCandidate(sparse, { sourceRecordId: 'rec-a' });
    const b = service.createEventFromCandidate(complete, { sourceRecordId: 'rec-b' });

    const scoreOf = (id: string): number =>
      repository.allEvents().find((row) => row.id === id)?.qualityScore ?? -1;
    expect(scoreOf(a.eventId)).toBeLessThan(scoreOf(b.eventId));
    expect(scoreOf(b.eventId)).toBeGreaterThan(80);
  });
});
