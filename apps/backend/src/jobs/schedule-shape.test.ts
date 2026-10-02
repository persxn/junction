import { describe, expect, it } from 'vitest';

import type { JobStateRow } from '../db/schema/index.js';
import type { JobStateShape } from '../domain/jobs/schedule.js';

/**
 * `domain/jobs/schedule.ts` is typed against `JobStateShape` rather than the
 * Drizzle row (pre-M2b moved it out of `src/jobs/`). The two must stay the
 * same shape; these assignments fail `pnpm typecheck` the day they drift.
 */
describe('JobStateShape', () => {
  it('is the job_state row, field for field, in both directions', () => {
    const row = {} as JobStateRow;
    const shape: JobStateShape = row;
    const back: JobStateRow = shape;
    expect(back).toBe(row);
  });
});
