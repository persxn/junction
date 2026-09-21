import type {
  ClaimGroup,
  DetailConflict,
  EventCategoryDetail,
  EventChangeDto,
  EventDetailView,
  EventSourceDetail,
} from '@compintel/contracts';

import { NOW } from './clock.js';

/**
 * The WP-16b conflict fixture, as the drawer receives it.
 *
 * It mirrors `apps/backend/test/fixtures/conflicts/three-sources-disagree.json`
 * — three sources, disagreeing on the registration deadline, the prize and the
 * team size — so the component tests and the backend tests are talking about
 * the same event, and the E2E can open the real thing and see the same words.
 */

const DAY = 86_400_000;
const HOUR = 3_600_000;
export const EVENT_ID = '0192a000-0000-7000-8000-00000000c0f1';

const id = (n: number): string => `0192a000-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;

const SOURCES: EventSourceDetail[] = [
  {
    key: 'hackxyz-site',
    name: 'hackxyz-site',
    url: 'https://hackxyz.example.edu/',
    firstSeenAt: NOW - 20 * DAY,
    lastSeenAt: NOW - 2 * HOUR,
    lastFetchedAt: NOW - 2 * HOUR,
    attributionText: null,
    trustRank: 80,
  },
  {
    key: 'devfolio',
    name: 'Devfolio',
    url: 'https://hackxyz-2026.devfolio.example/',
    firstSeenAt: NOW - 18 * DAY,
    lastSeenAt: NOW - 3 * HOUR,
    lastFetchedAt: NOW - 3 * HOUR,
    attributionText: 'Listing data from Devfolio.',
    trustRank: 60,
  },
  {
    key: 'ctftime',
    name: 'CTFtime',
    url: 'https://ctftime.example/event/9100',
    firstSeenAt: NOW - 16 * DAY,
    lastSeenAt: NOW - 4 * HOUR,
    lastFetchedAt: NOW - 4 * HOUR,
    attributionText: 'Event data from CTFtime.org.',
    trustRank: 40,
  },
];

const claim = (
  n: number,
  value: unknown,
  source: EventSourceDetail,
  isSelected: boolean,
): ClaimGroup['claims'][number] => ({
  id: id(n),
  value: value as ClaimGroup['claims'][number]['value'],
  sourceKey: source.key,
  sourceName: source.name,
  trustRank: source.trustRank,
  observedAt: source.lastFetchedAt,
  isSelected,
  isAlternate: false,
  note: null,
});

export const DEADLINE_SELECTED = NOW + 12 * DAY;

const CLAIMS: ClaimGroup[] = [
  {
    field: 'registrationDeadlineAt',
    label: 'Registration deadline',
    claims: [
      claim(10, DEADLINE_SELECTED, SOURCES[0]!, true),
      claim(11, DEADLINE_SELECTED + DAY, SOURCES[1]!, false),
      claim(12, DEADLINE_SELECTED + 5 * HOUR, SOURCES[2]!, false),
    ],
    selectedReason: 'HIGHEST_TRUST',
    selectedSourceName: 'hackxyz-site',
    verifiedAt: NOW - 2 * HOUR,
  },
  {
    field: 'prizeText',
    label: 'Prize',
    claims: [
      claim(20, '₹2,00,000 prize pool', SOURCES[0]!, true),
      claim(21, '₹1,50,000 and goodies', SOURCES[1]!, false),
      claim(22, '$2,000', SOURCES[2]!, false),
    ],
    selectedReason: 'HIGHEST_TRUST',
    selectedSourceName: 'hackxyz-site',
    verifiedAt: NOW - 2 * HOUR,
  },
  {
    field: 'teamMax',
    label: 'Largest team',
    claims: [
      claim(30, 4, SOURCES[0]!, true),
      claim(31, 5, SOURCES[1]!, false),
      claim(32, 6, SOURCES[2]!, false),
    ],
    selectedReason: 'HIGHEST_TRUST',
    selectedSourceName: 'hackxyz-site',
    verifiedAt: NOW - 2 * HOUR,
  },
  {
    field: 'organizerName',
    label: 'Organizer',
    claims: [claim(40, 'HackXYZ', SOURCES[0]!, true)],
    selectedReason: 'ONLY_SOURCE',
    selectedSourceName: 'hackxyz-site',
    verifiedAt: NOW - 2 * HOUR,
  },
];

const conflictOf = (group: ClaimGroup, material: boolean): DetailConflict => ({
  field: group.field,
  label: group.label,
  material,
  values: group.claims.map((entry) => ({
    value: entry.value,
    sourceKey: entry.sourceKey,
    sourceRecordId: `r-${entry.sourceKey}`,
    trustRank: entry.trustRank,
    observedAt: entry.observedAt,
    alternate: false,
    note: null,
  })),
  selected: group.claims.find((entry) => entry.isSelected)?.value ?? null,
  selectedReason: group.selectedReason,
  selectedSourceName: group.selectedSourceName,
  selectedSourceRecordId: `r-${group.claims.find((entry) => entry.isSelected)?.sourceKey ?? ''}`,
});

export const CONFLICTS: DetailConflict[] = [
  conflictOf(CLAIMS[0]!, true),
  conflictOf(CLAIMS[2]!, true),
  conflictOf(CLAIMS[1]!, false),
];

const CATEGORIES: EventCategoryDetail[] = [
  { id: id(50), name: 'AI/ML', slug: 'ai-ml', origin: 'RULE', isSuppressed: false },
  { id: id(51), name: 'Web', slug: 'web', origin: 'SOURCE_TAG', isSuppressed: false },
  { id: id(52), name: 'Robotics', slug: 'robotics', origin: 'MANUAL', isSuppressed: true },
];

const HISTORY: EventChangeDto[] = [
  {
    id: id(90),
    field: 'registrationDeadlineAt',
    fieldLabel: 'Registration deadline',
    oldValue: DEADLINE_SELECTED - DAY,
    newValue: DEADLINE_SELECTED,
    cause: 'SCRAPE',
    causeLabel: 'Found by a scrape',
    sourceRecordId: 'r-hackxyz-site',
    changedBy: null,
    detectedAt: NOW - 2 * HOUR,
  },
  {
    id: id(89),
    field: 'prizeText',
    fieldLabel: 'Prize',
    oldValue: '$2,000',
    newValue: '₹1,50,000 and goodies',
    cause: 'MERGE',
    causeLabel: 'Merged with a duplicate',
    sourceRecordId: null,
    changedBy: null,
    detectedAt: NOW - 3 * HOUR,
  },
];

/** The older page "Load older" fetches. */
export const OLDER_HISTORY: EventChangeDto[] = [
  {
    id: id(88),
    field: 'teamMax',
    fieldLabel: 'Largest team',
    oldValue: 6,
    newValue: 4,
    cause: 'OVERRIDE',
    causeLabel: 'Corrected by hand',
    sourceRecordId: null,
    changedBy: id(1),
    detectedAt: NOW - 5 * HOUR,
  },
];

export function detailFixture(overrides: Partial<EventDetailView> = {}): EventDetailView {
  return {
    id: EVENT_ID,
    title: 'HackXYZ 2026 AI Hackathon',
    eventType: 'HACKATHON',
    mode: 'OFFLINE',
    organizerName: 'HackXYZ',
    organizerKind: 'COLLEGE',
    city: 'Pune',
    countryCode: 'IN',
    startsAt: NOW + 20 * DAY,
    endsAt: NOW + 21 * DAY,
    registrationDeadlineAt: DEADLINE_SELECTED,
    registrationDeadlinePrecision: 'DATETIME',
    datePrecision: 'DATE',
    feeKnown: false,
    feeMinor: null,
    feeCurrency: null,
    teamMin: 2,
    teamMax: 4,
    editionYear: 2026,
    isRecurringRound: false,
    cancellation: 'NONE',
    visibility: 'VISIBLE',
    qualityScore: 70,
    hasConflicts: true,
    officialUrl: 'https://hackxyz.example.edu/',
    normalizedTitle: 'hackxyz 2026 ai hackathon',
    seriesId: null,
    hostInstitutionId: null,
    summary: null,
    descriptionMd: 'A 24-hour hackathon in Pune.',
    prizeText: '₹2,00,000 prize pool',
    prizeTotalMinor: null,
    prizeCurrency: null,
    eligibilityText: null,
    requirementsText: null,
    submissionRequirementsText: null,
    venueName: 'HackXYZ Campus',
    state: 'Maharashtra',
    lat: 18.52,
    lon: 73.85,
    geoPrecision: 'CITY',
    timezone: 'Asia/Kolkata',
    registrationOpensAt: null,
    submissionDeadlineAt: null,
    feeText: null,
    registrationUrl: 'https://hackxyz-2026.devfolio.example/',
    cancellationOrigin: null,
    mergedIntoEventId: null,
    policyReason: null,
    lastVerifiedAt: NOW - 2 * HOUR,
    lastChangedAt: NOW - 2 * HOUR,
    firstSeenAt: NOW - 20 * DAY,
    createdAt: NOW - 20 * DAY,
    updatedAt: NOW - 2 * HOUR,
    version: 3,
    distanceKm: 202,
    deadlines: [
      {
        id: id(60),
        kind: 'REGISTRATION',
        label: 'Registration closes',
        dueAt: DEADLINE_SELECTED,
        precision: 'DATETIME',
        origin: 'SOURCE',
      },
      {
        id: id(61),
        kind: 'PPT',
        label: 'Slide deck due',
        dueAt: DEADLINE_SELECTED + 3 * DAY,
        precision: 'DATE',
        origin: 'SOURCE',
      },
      {
        id: id(62),
        kind: 'FINAL_SUBMISSION',
        label: 'Final submission',
        dueAt: DEADLINE_SELECTED + 10 * DAY,
        precision: 'DATE',
        origin: 'MANUAL',
      },
    ],
    claims: CLAIMS,
    conflicts: CONFLICTS,
    sources: SOURCES,
    categories: CATEGORIES,
    history: { items: HISTORY, nextCursor: id(89) },
    ...overrides,
  };
}
