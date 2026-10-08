import type { OutcomeInput } from '@compintel/contracts';

import type { Principal } from '../modules/auth/types.js';
import type { OutcomesModule } from '../modules/outcomes/wiring.js';

/**
 * WP-21: outcomes on the demo's COMPLETED competitions, recorded through the
 * real service so each is audited like a person's. Amounts keep their own
 * currency (R63). Synthetic data only (D-33).
 */

const RESULTS: readonly OutcomeInput[] = [
  {
    result: 'WINNER',
    rank: 1,
    prizeText: 'First prize',
    prizeMinor: 5_000_000,
    prizeCurrency: 'INR',
    certificate: { uri: 'https://example.org/demo/certificate-winner.pdf', label: 'Certificate' },
  },
  { result: 'RUNNER_UP', rank: 2, prizeMinor: 50_000, prizeCurrency: 'USD' },
  { result: 'FINALIST', feedback: 'Strong demo; tighten the pitch.' },
];

export function seedDemoOutcomes(
  outcomes: OutcomesModule,
  completedIds: readonly string[],
  professor: Principal,
): number {
  completedIds.forEach((id, index) => {
    const input = RESULTS[index % RESULTS.length];
    if (input !== undefined) outcomes.service.record({ actor: professor }, id, input);
  });
  return completedIds.length;
}
