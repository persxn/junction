-- WP-22: the deadline read model (§12, §6.4, ruling R106).
--
-- Custom SQL (`db:generate:custom`), because a view is not part of the Drizzle
-- schema. It stores nothing, so it can never disagree with its sources; the
-- Radar, the KPI strip and the deadline evaluator all read this one definition.
-- It has no user column: scope (mine · team · all) is a join in the repository,
-- and the bucket is computed at request time, never stored.
--
-- Rows:
--   * event deadlines of VISIBLE, non-cancelled events that someone has saved or
--     that have an active competition (ASSIGNED · APPLIED · PARTICIPATING);
--   * the event's own registration and submission columns, only where no
--     `event_deadlines` row of that kind exists — so no deadline appears twice
--     (a manually created event has the columns and no rows);
--   * due dates of stages that are neither COMPLETED nor SKIPPED, and of open
--     tasks, in active competitions.
-- A past event deadline is dropped by the domain (`isLive`), not here: the view
-- holds no clock.
CREATE VIEW `v_deadlines` AS
WITH live_events AS (
  SELECT e.id, e.title, e.timezone, e.registration_deadline_at, e.registration_deadline_precision,
    e.submission_deadline_at, e.date_precision,
    (SELECT s.name FROM source_records r JOIN sources s ON s.id = r.source_id
       WHERE r.event_id = e.id ORDER BY r.last_seen_at DESC, r.id LIMIT 1) AS source_name
  FROM events e
  WHERE e.visibility = 'VISIBLE' AND e.cancellation = 'NONE'
    AND (EXISTS (SELECT 1 FROM watchlist_items w WHERE w.event_id = e.id)
      OR EXISTS (SELECT 1 FROM engagements g WHERE g.event_id = e.id
                   AND g.status IN ('ASSIGNED', 'APPLIED', 'PARTICIPATING')))
),
active_work AS (
  SELECT g.id AS engagement_id, g.team_id, t.name AS team_name, ev.id AS event_id,
    ev.title AS event_title, ev.timezone AS event_timezone,
    COALESCE(t.name,
      (SELECT CASE WHEN st.erased_at IS NULL THEN st.full_name ELSE 'Erased student' END
         FROM engagement_participants p JOIN students st ON st.id = p.student_id
         WHERE p.engagement_id = g.id ORDER BY p.added_at LIMIT 1),
      'Individual') || ' — ' || ev.title AS competition_name
  FROM engagements g
  JOIN events ev ON ev.id = g.event_id
  LEFT JOIN teams t ON t.id = g.team_id
  WHERE g.status IN ('ASSIGNED', 'APPLIED', 'PARTICIPATING')
)
SELECT 'deadline:' || d.id AS id, 'EVENT_DEADLINE' AS item_kind, d.kind AS deadline_kind,
  d.label AS label, d.due_at AS due_at, d.precision AS precision, e.id AS event_id,
  e.title AS event_title, e.timezone AS event_timezone, NULL AS engagement_id,
  NULL AS competition_name, NULL AS team_id, NULL AS team_name, NULL AS stage_id,
  NULL AS task_id, d.origin AS origin, src.name AS source_name
FROM event_deadlines d
JOIN live_events e ON e.id = d.event_id
LEFT JOIN source_records r ON r.id = d.source_record_id
LEFT JOIN sources src ON src.id = r.source_id
UNION ALL
SELECT 'event-reg:' || e.id, 'EVENT_DEADLINE', 'REGISTRATION', 'Registration closes',
  e.registration_deadline_at, e.registration_deadline_precision, e.id, e.title, e.timezone,
  NULL, NULL, NULL, NULL, NULL, NULL,
  CASE WHEN e.source_name IS NULL THEN 'MANUAL' ELSE 'SOURCE' END, e.source_name
FROM live_events e
WHERE e.registration_deadline_at IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM event_deadlines d WHERE d.event_id = e.id AND d.kind = 'REGISTRATION')
UNION ALL
SELECT 'event-sub:' || e.id, 'EVENT_DEADLINE', 'FINAL_SUBMISSION', 'Final submission',
  e.submission_deadline_at, e.date_precision, e.id, e.title, e.timezone,
  NULL, NULL, NULL, NULL, NULL, NULL,
  CASE WHEN e.source_name IS NULL THEN 'MANUAL' ELSE 'SOURCE' END, e.source_name
FROM live_events e
WHERE e.submission_deadline_at IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM event_deadlines d WHERE d.event_id = e.id AND d.kind = 'FINAL_SUBMISSION')
UNION ALL
SELECT 'stage:' || s.id, 'STAGE', NULL, s.name, s.due_at, 'DATETIME', a.event_id, a.event_title,
  a.event_timezone, a.engagement_id, a.competition_name, a.team_id, a.team_name, s.id, NULL,
  'STAGE', NULL
FROM workflow_stages s
JOIN workflows w ON w.id = s.workflow_id
JOIN active_work a ON a.engagement_id = w.engagement_id
WHERE s.due_at IS NOT NULL AND s.status NOT IN ('COMPLETED', 'SKIPPED')
UNION ALL
SELECT 'task:' || k.id, 'TASK', NULL, k.title, k.due_at, 'DATETIME', a.event_id, a.event_title,
  a.event_timezone, a.engagement_id, a.competition_name, a.team_id, a.team_name, s.id, k.id,
  'TASK', NULL
FROM tasks k
JOIN workflow_stages s ON s.id = k.stage_id
JOIN workflows w ON w.id = s.workflow_id
JOIN active_work a ON a.engagement_id = w.engagement_id
WHERE k.due_at IS NOT NULL AND k.is_done = 0;
