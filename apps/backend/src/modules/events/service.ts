import type {
  EventCandidate,
  EventTypePolicy,
  GeographyPolicy,
  OverrideField,
  PolicyReason,
} from '@compintel/contracts';

import { qualityScore } from '../../domain/events/quality.js';
import { applyPolicies } from '../../domain/policy/index.js';
import { normalizeTitle } from '../../domain/normalize/text.js';
import { combinedPrecision } from '../../domain/normalize/dates.js';
import { withAudit, type AuditLog } from '../../platform/audit.js';
import type { SettingsStore } from '../../platform/settings.js';
import { nowMs, systemClock, type Clock } from '../../platform/time.js';
import { EVENT_TYPE_POLICY, GEOGRAPHY_POLICY } from '../geo/settings.js';
import type { Geocoder } from '../geo/geocoder.js';
import type { EventsRepository, NewClaim, NewDeadline } from './repository.js';

/**
 * Turning a normalized candidate into a stored event (§7, rulings R55 and R57).
 *
 * The pipeline, in one place: **normalize → geocode → apply the policies →
 * store**. WP-08a owns the first step, this module the rest, and WP-09b will be
 * the first thing to feed it from a real source.
 *
 * The whole point of the order is that the policy runs on *resolved* facts. An
 * event whose country is only known after geocoding cannot be judged before it,
 * and judging it wrong means either burying a local event or filling the feed
 * with Seoul.
 */

export interface EventsServiceDependencies {
  readonly repository: EventsRepository;
  readonly geocoder: Geocoder;
  readonly settings: SettingsStore;
  readonly audit: AuditLog;
  readonly clock?: Clock;
}

export interface CreateEventContext {
  /** The `source_records.id` this candidate came from; no FK yet (R49). */
  readonly sourceRecordId: string;
  readonly requestId?: string | undefined;
}

export interface CreateEventResult {
  readonly eventId: string;
  readonly visibility: 'VISIBLE' | 'POLICY_HIDDEN';
  readonly policyReason?: PolicyReason | undefined;
  readonly geoPrecision: string;
}

/** The candidate fields worth recording a provenance claim for (R48). */
const CLAIMED_FIELDS: readonly OverrideField[] = [
  'title',
  'eventType',
  'mode',
  'startsAt',
  'endsAt',
  'registrationDeadlineAt',
  'city',
  'countryCode',
  'feeMinor',
  'teamMin',
  'teamMax',
  'officialUrl',
];

export class EventsService {
  readonly #repository: EventsRepository;
  readonly #geocoder: Geocoder;
  readonly #settings: SettingsStore;
  readonly #audit: AuditLog;
  readonly #clock: Clock;

  constructor(dependencies: EventsServiceDependencies) {
    this.#repository = dependencies.repository;
    this.#geocoder = dependencies.geocoder;
    this.#settings = dependencies.settings;
    this.#audit = dependencies.audit;
    this.#clock = dependencies.clock ?? systemClock;
  }

  policies(): { eventType: EventTypePolicy; geography: GeographyPolicy } {
    return {
      eventType: this.#settings.get(EVENT_TYPE_POLICY),
      geography: this.#settings.get(GEOGRAPHY_POLICY),
    };
  }

  /**
   * Stores one candidate, with its deadlines and its claims, in one transaction
   * wrapped in `withAudit` (R35). A hidden event is stored exactly like a
   * visible one — that is R57, and it is what makes a policy change cheap.
   */
  createEventFromCandidate(
    candidate: EventCandidate,
    context: CreateEventContext,
  ): CreateEventResult {
    const at = nowMs(this.#clock);
    const geo = this.#geocoder.resolve(candidate.place);
    const verdict = applyPolicies(
      {
        mode: candidate.mode.value,
        countryCode: geo.countryCode,
        eventType: candidate.eventType.value,
        confidence: candidate.eventType.confidence,
      },
      this.policies(),
    );

    const deadlines: NewDeadline[] = [
      ...(candidate.registrationDeadlineAt === undefined
        ? []
        : [
            {
              kind: 'REGISTRATION' as const,
              label: 'Registration closes',
              dueAt: candidate.registrationDeadlineAt.at,
              precision: candidate.registrationDeadlineAt.precision,
              sourceRecordId: context.sourceRecordId,
            },
          ]),
      ...(candidate.deadlines ?? []).map((deadline) => ({
        kind: deadline.kind,
        label: deadline.label,
        dueAt: deadline.dueAt,
        precision: deadline.precision,
        sourceRecordId: context.sourceRecordId,
      })),
    ];

    const claims: NewClaim[] = CLAIMED_FIELDS.map((field) => ({
      field,
      valueJson: JSON.stringify(claimValue(candidate, geo.countryCode, geo.city, field)) ?? null,
      sourceRecordId: context.sourceRecordId,
      observedAt: at,
      // One source so far, so its claim is the one on the row. WP-10 decides
      // this properly once two sources can disagree.
      isSelected: true,
    }));

    const eventId = withAudit(
      this.#audit,
      (id: string) => ({
        actorKind: 'SYSTEM' as const,
        actorUserId: null,
        action: 'event.created',
        entityKind: 'event',
        entityId: id,
        summary:
          `${candidate.title} from ${candidate.sourceKey}` +
          (verdict.visibility === 'POLICY_HIDDEN'
            ? ` — hidden by policy (${verdict.reason ?? ''})`
            : ''),
        diff: {
          sourceKey: candidate.sourceKey,
          externalKey: candidate.externalKey,
          visibility: verdict.visibility,
          ...(verdict.reason === undefined ? {} : { policyReason: verdict.reason }),
          geoPrecision: geo.geoPrecision,
          warnings: candidate.warnings.length,
        },
        requestId: context.requestId ?? null,
      }),
      (): string =>
        this.#repository.insert(
          {
            title: candidate.title,
            normalizedTitle: normalizeTitle(candidate.title),
            eventType: candidate.eventType.value,
            isRecurringRound: candidate.isRecurringRound,
            visibility: verdict.visibility,
            policyReason: verdict.reason,
            qualityScore: qualityScore(candidate),
            firstSeenAt: at,
            lastChangedAt: at,
            createdAt: at,
            updatedAt: at,
            fields: {
              organizerName: candidate.organizerName ?? null,
              summary: candidate.summary ?? null,
              descriptionMd: candidate.descriptionMd ?? null,
              prizeText: candidate.prize?.text ?? null,
              prizeTotalMinor: candidate.prize?.totalMinor ?? null,
              prizeCurrency: candidate.prize?.currency ?? null,
              eligibilityText: candidate.eligibilityText ?? null,
              eligibilityJson:
                candidate.eligibility === undefined ? null : JSON.stringify(candidate.eligibility),
              requirementsText: candidate.requirementsText ?? null,
              submissionRequirementsText: candidate.submissionRequirementsText ?? null,
              mode: candidate.mode.value,
              venueName: candidate.place?.venueName ?? null,
              city: geo.city ?? null,
              state: geo.state ?? null,
              countryCode: geo.countryCode ?? null,
              lat: geo.lat ?? null,
              lon: geo.lon ?? null,
              geoPrecision: geo.geoPrecision,
              hostInstitutionId: geo.institutionId ?? null,
              timezone: candidate.timezone ?? null,
              registrationOpensAt: candidate.registrationOpensAt?.at ?? null,
              registrationDeadlineAt: candidate.registrationDeadlineAt?.at ?? null,
              registrationDeadlinePrecision:
                candidate.registrationDeadlineAt?.precision ?? 'UNKNOWN',
              startsAt: candidate.startsAt?.at ?? null,
              endsAt: candidate.endsAt?.at ?? null,
              submissionDeadlineAt: candidate.submissionDeadlineAt?.at ?? null,
              datePrecision: combinedPrecision({
                startsAt: candidate.startsAt,
                endsAt: candidate.endsAt,
              }),
              teamMin: candidate.teamSize?.min ?? null,
              teamMax: candidate.teamSize?.max ?? null,
              feeKnown: candidate.fee?.known ?? false,
              feeMinor: candidate.fee?.known === true ? (candidate.fee.minor ?? null) : null,
              feeCurrency: candidate.fee?.known === true ? (candidate.fee.currency ?? null) : null,
              feeText: candidate.fee?.text ?? null,
              officialUrl: candidate.officialUrl ?? candidate.url,
              registrationUrl: candidate.registrationUrl ?? null,
              editionYear: candidate.editionYear ?? null,
            },
          },
          deadlines,
          claims,
        ),
    );

    return {
      eventId,
      visibility: verdict.visibility,
      policyReason: verdict.reason,
      geoPrecision: geo.geoPrecision,
    };
  }

  /**
   * Re-runs the policies over every stored event and updates the two columns
   * that changed (R57).
   *
   * This is the operation that makes "changing a policy needs no re-scrape"
   * literally true, and the §19 criterion tests exactly it: flip
   * `allowCountries` to include `KR` and the Seoul event becomes visible.
   */
  reapplyPolicies(): { changed: number; visible: number; hidden: number } {
    const at = nowMs(this.#clock);
    const policies = this.policies();
    let changed = 0;
    let visible = 0;
    let hidden = 0;

    for (const row of this.#repository.allEvents()) {
      // A person's decision and a merge are not a policy's to undo.
      if (row.visibility === 'ADMIN_HIDDEN' || row.visibility === 'MERGED') {
        continue;
      }
      const verdict = applyPolicies(
        {
          mode: row.mode,
          countryCode: row.countryCode ?? undefined,
          eventType: row.eventType,
        },
        policies,
      );
      if (verdict.visibility === 'VISIBLE') {
        visible += 1;
      } else {
        hidden += 1;
      }
      if (verdict.visibility !== row.visibility || (verdict.reason ?? null) !== row.policyReason) {
        this.#repository.setVisibility(row.id, verdict.visibility, verdict.reason, at);
        changed += 1;
      }
    }
    return { changed, visible, hidden };
  }
}

/** The value a claim records for one field. */
function claimValue(
  candidate: EventCandidate,
  countryCode: string | undefined,
  city: string | undefined,
  field: OverrideField,
): unknown {
  switch (field) {
    case 'title':
      return candidate.title;
    case 'eventType':
      return candidate.eventType.value;
    case 'mode':
      return candidate.mode.value;
    case 'startsAt':
      return candidate.startsAt?.at ?? null;
    case 'endsAt':
      return candidate.endsAt?.at ?? null;
    case 'registrationDeadlineAt':
      return candidate.registrationDeadlineAt?.at ?? null;
    case 'city':
      return city ?? candidate.place?.city ?? null;
    case 'countryCode':
      return countryCode ?? candidate.place?.countryCode ?? null;
    case 'feeMinor':
      return candidate.fee?.known === true ? (candidate.fee.minor ?? null) : null;
    case 'teamMin':
      return candidate.teamSize?.min ?? null;
    case 'teamMax':
      return candidate.teamSize?.max ?? null;
    case 'officialUrl':
      return candidate.officialUrl ?? candidate.url;
    default:
      return null;
  }
}
