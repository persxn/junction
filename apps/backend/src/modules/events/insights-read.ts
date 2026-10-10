import type { SourceContribution } from '@compintel/contracts';

import type { Span } from '../../domain/insights/calendar.js';
import type { DatabaseHandle } from '../../platform/db.js';

/**
 * Source contribution (WP-33, R69): which ingestion sources produced the events
 * that actually got assigned — the loop back to M1 that says which sources earn
 * their keep. An event several sources reported counts once for each of them;
 * a hand-entered event counts for the manual source that recorded it.
 */
export class EventInsightsReader {
  readonly #db: DatabaseHandle;

  constructor(db: DatabaseHandle) {
    this.#db = db;
  }

  sources(span: Span): SourceContribution[] {
    const rows = this.#db.raw
      .prepare(
        `SELECT so.id AS sourceId, so.name AS name,
                (SELECT COUNT(DISTINCT r.event_id) FROM source_records r
                  WHERE r.source_id = so.id AND r.event_id IS NOT NULL
                    AND r.first_seen_at >= ? AND r.first_seen_at < ?) AS events,
                (SELECT COUNT(DISTINCT g.event_id) FROM engagements g
                   JOIN source_records r ON r.event_id = g.event_id AND r.source_id = so.id
                  WHERE g.created_at >= ? AND g.created_at < ?
                    AND EXISTS (SELECT 1 FROM engagement_status_history h
                                 WHERE h.engagement_id = g.id AND h.to_status = 'ASSIGNED')
                ) AS assigned
           FROM sources so
          ORDER BY assigned DESC, events DESC, name, sourceId`,
      )
      .all(span.start, span.end, span.start, span.end) as SourceContribution[];
    return rows.filter((row) => row.events > 0 || row.assigned > 0);
  }
}
