-- pre-M2b / ruling R88: trust is denormalized.
--
-- `events.top_trust_rank` is the highest trust_rank among the sources that list
-- the event, kept by the resolver on every link, merge and unmerge. RELEVANCE's
-- TRUSTED_SOURCE boost reads it instead of a per-row subquery over
-- source_records, which WP-15b measured at ~12 ms per 19k rows.
ALTER TABLE `events` ADD `top_trust_rank` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
-- The backfill: every event that already has records gets its value now. A
-- merged-away event's records point at the survivor, so it backfills to 0,
-- which is what the resolver would write for it too.
UPDATE `events`
SET `top_trust_rank` = coalesce((
  SELECT max(s.`trust_rank`) FROM `source_records` sr
  JOIN `sources` s ON s.`id` = sr.`source_id`
  WHERE sr.`event_id` = `events`.`id`
), 0);
