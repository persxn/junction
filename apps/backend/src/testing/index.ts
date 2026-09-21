/**
 * `@compintel/backend/testing` — the demo and fixture helpers the dev tools
 * need (`pnpm seed:demo`). Deliberately a separate entry point: nothing here is
 * part of the running application, and the main entry point does not re-export
 * it.
 */
export { seedScenario, type SeedScenarioResult } from './conflicts.js';
