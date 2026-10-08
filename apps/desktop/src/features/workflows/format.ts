import { formatDeadline } from '../discover/detail/values.js';

/** A stage or task date in words, in the display zone: "31 Oct, 23:59" (WP-20a). */
export const formatDue = (iso: string, now: number): string =>
  formatDeadline(Date.parse(iso), 'DATETIME', now);
