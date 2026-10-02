-- pre-M2b / ruling R87: event tags come from source tags.
--
-- 1. `events.tags_text` (generated): the event's tag names, one per line,
--    written by the categories module together with `event_tags`. It exists for
--    the FTS index: `event_fts` is external-content, and a 'delete' must be
--    given exactly the text that was indexed — a subquery over `event_tags`
--    would already see the new tags by the time a trigger asked for the old.
ALTER TABLE `events` ADD `tags_text` text DEFAULT '' NOT NULL;
--> statement-breakpoint
-- 2. The view and the three triggers from 0014 read `tags_text` where they
--    supplied an empty string, and the update trigger also fires on it.
DROP TRIGGER `events_search_ai`;
--> statement-breakpoint
DROP TRIGGER `events_search_ad`;
--> statement-breakpoint
DROP TRIGGER `events_search_au`;
--> statement-breakpoint
DROP VIEW `event_search_source`;
--> statement-breakpoint
CREATE VIEW `event_search_source` AS
SELECT
  `rowid` AS `event_rowid`,
  `title`,
  `organizer_name` AS `organizer`,
  `tags_text` AS `tags`,
  `description_md` AS `description`
FROM `events`;
--> statement-breakpoint
CREATE TRIGGER `events_search_ai` AFTER INSERT ON `events` BEGIN
  INSERT INTO `event_fts` (rowid, title, organizer, tags, description)
    VALUES (new.rowid, new.title, new.organizer_name, new.tags_text, new.description_md);
  INSERT INTO `event_fts_trigram` (rowid, title, organizer)
    VALUES (new.rowid, new.title, new.organizer_name);
END;
--> statement-breakpoint
CREATE TRIGGER `events_search_ad` AFTER DELETE ON `events` BEGIN
  INSERT INTO `event_fts` (event_fts, rowid, title, organizer, tags, description)
    VALUES ('delete', old.rowid, old.title, old.organizer_name, old.tags_text, old.description_md);
  INSERT INTO `event_fts_trigram` (event_fts_trigram, rowid, title, organizer)
    VALUES ('delete', old.rowid, old.title, old.organizer_name);
END;
--> statement-breakpoint
CREATE TRIGGER `events_search_au` AFTER UPDATE OF `title`, `organizer_name`, `description_md`, `tags_text` ON `events` BEGIN
  INSERT INTO `event_fts` (event_fts, rowid, title, organizer, tags, description)
    VALUES ('delete', old.rowid, old.title, old.organizer_name, old.tags_text, old.description_md);
  INSERT INTO `event_fts_trigram` (event_fts_trigram, rowid, title, organizer)
    VALUES ('delete', old.rowid, old.title, old.organizer_name);
  INSERT INTO `event_fts` (rowid, title, organizer, tags, description)
    VALUES (new.rowid, new.title, new.organizer_name, new.tags_text, new.description_md);
  INSERT INTO `event_fts_trigram` (rowid, title, organizer)
    VALUES (new.rowid, new.title, new.organizer_name);
END;
--> statement-breakpoint
-- Every existing tags value is '', which is what the old triggers indexed, so
-- the index is already consistent; a rebuild makes that true by construction.
INSERT INTO `event_fts` (event_fts) VALUES ('rebuild');
--> statement-breakpoint
-- 3. The backfill. Tags are derived in TypeScript (`categories/domain/tags.ts`)
--    by the same pass that re-derives categories, so existing events get theirs
--    from one run of the resumable `categories:reclassify` job — chunked,
--    restart-safe, and already how a rule edit reaches old events. Queued only
--    when there is something to backfill; an empty database needs no run.
UPDATE `category_reclassify_runs` SET `finished_at` = 1790899200000 WHERE `finished_at` IS NULL;
--> statement-breakpoint
INSERT INTO `category_reclassify_runs` (`id`, `reason`, `requested_at`, `requested_by`)
SELECT '0199a4c0-8700-7000-8000-000000000087', 'R87: event tags from source tags (pre-M2b backfill)', 1790899200000, NULL
WHERE EXISTS (SELECT 1 FROM `events`);
