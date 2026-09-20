import type { NormalizeCase } from './case.js';

/**
 * The shape of the result itself: what a bare record produces, what a full one
 * produces, and what is carried through untouched (§7.1, R50, R51).
 *
 * The first case is the one the prompt names and the one that matters most: a
 * record with every optional field absent must still validate, and must
 * normalize to a candidate that invented nothing.
 */

export const SHAPE_CASES: readonly NormalizeCase[] = [
  {
    name: 'a record with every optional field absent validates and invents nothing',
    input: {},
    ctx: { sourceTimezone: undefined },
    expect: {
      fields: {
        sourceKey: 'testsource',
        externalKey: 'e-1',
        url: 'https://example.org/events/1',
        title: 'Example Event',
        titleRaw: 'Example Event',
        'eventType.value': 'OTHER',
        'mode.value': 'UNKNOWN',
        isRecurringRound: false,
      },
      absent: [
        'organizerName',
        'summary',
        'descriptionMd',
        'prize',
        'eligibilityText',
        'eligibility',
        'requirementsText',
        'submissionRequirementsText',
        'place',
        'timezone',
        'registrationOpensAt',
        'registrationDeadlineAt',
        'startsAt',
        'endsAt',
        'submissionDeadlineAt',
        'resultAt',
        'deadlines',
        'teamSize',
        'fee',
        'officialUrl',
        'registrationUrl',
        'editionYear',
        'seriesHint',
        'sourceTags',
      ],
      // Nothing was attempted, so nothing failed.
      noWarnings: [
        'DATE_UNPARSEABLE',
        'FEE_UNPARSEABLE',
        'TEAM_SIZE_UNPARSEABLE',
        'PII_REDACTED',
        'URL_INVALID',
      ],
    },
  },
  {
    name: 'the source key, external key and tags are carried through untouched',
    input: { sourceKey: 'ctftime', externalKey: '3417', sourceTags: ['jeopardy', 'online'] },
    expect: {
      fields: {
        sourceKey: 'ctftime',
        externalKey: '3417',
        sourceTags: ['jeopardy', 'online'],
      },
    },
  },
  {
    name: 'the place is kept exactly as the source stated it, unresolved',
    input: {
      place: { venueName: 'Powai Campus', city: 'Mumbai', state: 'Maharashtra', countryCode: 'IN' },
    },
    expect: {
      fields: {
        'place.venueName': 'Powai Campus',
        'place.city': 'Mumbai',
        'place.state': 'Maharashtra',
        'place.countryCode': 'IN',
      },
      // No geocoding here: WP-08b owns the gazetteer.
      absent: [],
    },
  },
  {
    name: 'source-supplied coordinates are kept with their precision',
    input: { place: { lat: 19.1334, lon: 72.9133, geoPrecision: 'EXACT', countryCode: 'IN' } },
    expect: {
      fields: { 'place.lat': 19.1334, 'place.lon': 72.9133, 'place.geoPrecision': 'EXACT' },
    },
  },
  {
    name: 'the organizer name is trimmed but not interpreted',
    input: { organizerName: '  IIT Bombay  ' },
    expect: { fields: { organizerName: 'IIT Bombay' } },
  },
  {
    name: 'extra deadlines are carried through as rows',
    input: {
      deadlines: [
        {
          kind: 'ABSTRACT',
          label: 'Abstract submission',
          dueAt: 1_790_000_000_000,
          precision: 'DATE',
        },
        { kind: 'PPT', label: 'Slide deck', dueAt: 1_791_000_000_000, precision: 'DATETIME' },
      ],
    },
    expect: {
      fields: {
        'deadlines.0.kind': 'ABSTRACT',
        'deadlines.0.label': 'Abstract submission',
        'deadlines.1.kind': 'PPT',
      },
    },
  },
  {
    name: 'eligibility flags are carried through with their confidences',
    input: {
      eligibility: {
        undergraduate: { value: true, confidence: 0.9 },
        indiaOnly: { value: true, confidence: 1 },
      },
    },
    expect: {
      fields: {
        'eligibility.undergraduate.value': true,
        'eligibility.undergraduate.confidence': 0.9,
        'eligibility.indiaOnly.value': true,
      },
    },
  },
  {
    name: 'an eligibility flag nobody established stays absent, not false',
    input: { eligibility: { undergraduate: { value: true, confidence: 0.9 } } },
    expect: { fields: { 'eligibility.postgraduate': undefined } },
  },
  {
    name: 'the warnings array is always present, even when empty',
    input: {},
    ctx: { sourceTimezone: undefined },
    expect: { fields: { warnings: [] } },
  },
  {
    name: 'a fully populated record round-trips every family at once',
    input: {
      sourceKey: 'devfolio',
      externalKey: 'hack-2026',
      url: 'https://devfolio.co/hack?utm_source=x',
      title: 'HackX 2026',
      sourceType: 'hackathon',
      organizerName: 'IIT Bombay',
      description: '<p>Build for <strong>Bharat</strong>. Mail team@example.org.</p>',
      mode: 'OFFLINE',
      place: { venueName: 'Powai', city: 'Mumbai', countryCode: 'IN' },
      startsAt: { structured: '2026-03-14T09:00:00' },
      endsAt: { structured: '2026-03-15T18:00:00' },
      registrationDeadlineAt: { structured: '2026-03-01' },
      teamSizeText: 'Teams of up to 4',
      feeText: '₹500 per team',
      prizeText: 'Prize pool: ₹1,00,000',
      officialUrl: 'https://hackx.example.org',
      sourceTags: ['web3', 'ai'],
    },
    expect: {
      fields: {
        url: 'https://devfolio.co/hack',
        title: 'HackX 2026',
        'eventType.value': 'HACKATHON',
        'mode.value': 'OFFLINE',
        timezone: 'Asia/Kolkata',
        editionYear: 2026,
        'teamSize.max': 4,
        'fee.minor': 50_000,
        'prize.totalMinor': 10_000_000,
        isRecurringRound: false,
        'registrationDeadlineAt.at': Date.parse('2026-03-01T18:29:59.999Z'),
      },
      warnings: ['PII_REDACTED'],
    },
  },
];
