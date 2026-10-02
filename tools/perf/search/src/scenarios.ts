import type { SearchModule } from '@compintel/backend';
import type { EventQueryInput } from '@compintel/contracts';

import type { Prng } from './prng.js';

/** The scenarios `pnpm perf:search` times (see `run.ts`). */

/** §8.3 halved: 100 → 50 ms for queries, 150 → 75 ms for facets, 50 → 25 ms for detail. */
export const QUERY_BUDGET_MS = 50;
export const FACETS_BUDGET_MS = 75;
export const DETAIL_BUDGET_MS = 25;

export interface Scenario {
  readonly name: string;
  /** `undefined`: reported for information, never failed. */
  readonly budgetMs: number | undefined;
  /** Times itself (the default wraps `run`). */
  readonly run?: (rng: Prng) => void;
  readonly measure?: (rng: Prng) => number;
}

export function timed(scenario: Scenario, rng: Prng): number {
  if (scenario.measure !== undefined) return scenario.measure(rng);
  const started = performance.now();
  scenario.run?.(rng);
  return performance.now() - started;
}

export function scenarios(
  search: SearchModule,
  actor: { id: string; roles: ['PROFESSOR'] },
  visible: readonly string[],
): Scenario[] {
  const context = {
    actor: {
      ...actor,
      email: 'p@example.edu',
      displayName: 'Perf',
      departmentId: null,
      status: 'ACTIVE' as const,
      mustChangePassword: false,
    },
  };
  const texts = [
    'hackathon',
    'machine learning',
    'iit madras',
    'security challenge',
    'ml',
    'open source sprint',
    'quantum',
    'ackath',
    'hackthon',
    'cyber secuirty',
    'climate ideathon 2026',
    'nasscom',
  ];
  const types = ['HACKATHON', 'IDEATHON', 'CTF', 'CODING_CONTEST', 'INNOVATION_CHALLENGE'] as const;
  const filters = (rng: Prng): EventQueryInput => ({
    eventTypes: [rng.pick(types), rng.pick(types)],
    modes: ['OFFLINE', 'HYBRID', 'ONLINE'],
    registration: { states: ['OPEN', 'CLOSING_SOON'] },
    teamSizeFits: rng.int(1, 4),
    includeUnknown: { teamSize: true },
    ...(rng.chance(0.5)
      ? {
          feeMax: { minor: 100_000, currency: 'INR' },
          includeUnknown: { fee: true, teamSize: true },
        }
      : {}),
  });
  const facetQuery = (rng: Prng): EventQueryInput => ({
    ...(rng.chance(0.5) ? filters(rng) : {}),
    ...(rng.chance(0.5) ? { text: rng.pick(texts) } : {}),
    ...(rng.chance(0.5) ? { maxDistanceKm: rng.pick([50, 100, 250, 500]) } : {}),
  });
  const query = (input: EventQueryInput): void => {
    search.service.search(context, { ...input, facets: false });
  };
  return [
    {
      name: 'filters only',
      budgetMs: QUERY_BUDGET_MS,
      run: (rng) => {
        query({
          ...filters(rng),
          sort: rng.pick(['DEADLINE', 'START', 'PRIZE', 'NEWEST'] as const),
        });
      },
    },
    {
      name: 'filters + text',
      budgetMs: QUERY_BUDGET_MS,
      run: (rng) => {
        query({ ...filters(rng), text: rng.pick(texts), sort: 'RELEVANCE' });
      },
    },
    {
      name: 'text + distance',
      budgetMs: QUERY_BUDGET_MS,
      run: (rng) => {
        query({
          text: rng.pick(texts),
          maxDistanceKm: rng.pick([50, 100, 250, 500]),
          sort: 'DISTANCE',
        });
      },
    },
    {
      // §8.3 budgets facets as their own operation: what asking for them adds
      // to the same request, measured as a pair each iteration.
      name: 'facets (added)',
      budgetMs: FACETS_BUDGET_MS,
      measure: (rng) => {
        const body = facetQuery(rng);
        const started = performance.now();
        search.service.search(context, { ...body, facets: false });
        const without = performance.now() - started;
        const again = performance.now();
        search.service.search(context, body);
        return performance.now() - again - without;
      },
    },
    {
      // R88: the unfiltered first Discover page *with facets* — exactly what the
      // screen asks for on first load — is a named §8.3 scenario: 100 ms at 20 k
      // events, halved here.
      name: 'first page (R88)',
      budgetMs: QUERY_BUDGET_MS,
      run: () => {
        search.service.search(context, {});
      },
    },
    {
      // A first page with random filters and text — reported, not budgeted.
      name: 'first page+facets',
      budgetMs: undefined,
      run: (rng) => {
        search.service.search(context, facetQuery(rng));
      },
    },
    {
      name: 'unfiltered feed',
      budgetMs: undefined,
      run: () => {
        search.service.search(context, { facets: false });
      },
    },
    {
      name: 'detail by id',
      budgetMs: DETAIL_BUDGET_MS,
      run: (rng) => {
        search.service.detail(context, rng.pick(visible));
      },
    },
  ];
}
