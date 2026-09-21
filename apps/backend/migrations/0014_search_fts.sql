-- WP-15a: full-text search (§8.2, ADR-0006, rulings F5/A5 and F6).
--
-- Custom SQL (`db:generate:custom`), because Drizzle cannot model an FTS5
-- virtual table or a trigger (F6). `drizzle-kit push` is still never used.
--
-- Two indexes, two jobs, and they are not interchangeable (F5/A5):
--
--   event_fts          words. unicode61 with diacritics removed, porter on top,
--                      over title, organizer, tags and description; queried
--                      with bm25 weights 10 / 4 / 3 / 1.
--   event_fts_trigram  substrings of three characters or more over title and
--                      organizer ("ackath" finds "Hackathon"). It does NOT
--                      correct typos; that is the vocabulary + edit distance
--                      step in `modules/search/vocabulary.ts`.
--
-- Both are external-content tables: the text lives once, in `events`, and the
-- indexes hold only postings. Their content table is the view
-- `event_search_source` rather than `events` itself, for one reason: FTS5 reads
-- the content table's columns *by name* whenever it rebuilds, and `events` has
-- no `tags` column. The view renames `organizer_name`/`description_md` and
-- supplies `tags` as an empty string until the product stores event tags
-- (open question in the WP-15a handoff); the triggers index the same empty
-- string, so a 'delete' always removes exactly what an insert added.
--
-- The rowid is `events.rowid`. `events` has a TEXT primary key, so its rowid is
-- implicit; SQLite keeps it stable through updates and through the VACUUM INTO
-- copies the backend makes (asserted in `search-migration.test.ts`), and a
-- 'rebuild' re-derives both indexes from the view if that ever stops holding.
--
-- The update trigger fires only when an indexed column changes, so a merge, a
-- visibility flip or a quality-score refresh costs the indexes nothing.
-- Visibility is filtered at query time, never in the index, so a policy change
-- needs no reindex either (R57).
CREATE VIEW `event_search_source` AS
SELECT
  `rowid` AS `event_rowid`,
  `title`,
  `organizer_name` AS `organizer`,
  '' AS `tags`,
  `description_md` AS `description`
FROM `events`;
--> statement-breakpoint
CREATE VIRTUAL TABLE `event_fts` USING fts5(
  title,
  organizer,
  tags,
  description,
  content = 'event_search_source',
  content_rowid = 'event_rowid',
  tokenize = 'porter unicode61 remove_diacritics 2'
);
--> statement-breakpoint
CREATE VIRTUAL TABLE `event_fts_trigram` USING fts5(
  title,
  organizer,
  content = 'event_search_source',
  content_rowid = 'event_rowid',
  tokenize = 'trigram remove_diacritics 1'
);
--> statement-breakpoint
CREATE TRIGGER `events_search_ai` AFTER INSERT ON `events` BEGIN
  INSERT INTO `event_fts` (rowid, title, organizer, tags, description)
    VALUES (new.rowid, new.title, new.organizer_name, '', new.description_md);
  INSERT INTO `event_fts_trigram` (rowid, title, organizer)
    VALUES (new.rowid, new.title, new.organizer_name);
END;
--> statement-breakpoint
CREATE TRIGGER `events_search_ad` AFTER DELETE ON `events` BEGIN
  INSERT INTO `event_fts` (event_fts, rowid, title, organizer, tags, description)
    VALUES ('delete', old.rowid, old.title, old.organizer_name, '', old.description_md);
  INSERT INTO `event_fts_trigram` (event_fts_trigram, rowid, title, organizer)
    VALUES ('delete', old.rowid, old.title, old.organizer_name);
END;
--> statement-breakpoint
CREATE TRIGGER `events_search_au` AFTER UPDATE OF `title`, `organizer_name`, `description_md` ON `events` BEGIN
  INSERT INTO `event_fts` (event_fts, rowid, title, organizer, tags, description)
    VALUES ('delete', old.rowid, old.title, old.organizer_name, '', old.description_md);
  INSERT INTO `event_fts_trigram` (event_fts_trigram, rowid, title, organizer)
    VALUES ('delete', old.rowid, old.title, old.organizer_name);
  INSERT INTO `event_fts` (rowid, title, organizer, tags, description)
    VALUES (new.rowid, new.title, new.organizer_name, '', new.description_md);
  INSERT INTO `event_fts_trigram` (rowid, title, organizer)
    VALUES (new.rowid, new.title, new.organizer_name);
END;
--> statement-breakpoint
-- Events stored before this migration are indexed here, from the view.
INSERT INTO `event_fts` (event_fts) VALUES ('rebuild');
--> statement-breakpoint
INSERT INTO `event_fts_trigram` (event_fts_trigram) VALUES ('rebuild');
--> statement-breakpoint
-- §6.2's three starter synonyms. Stored one way; expansion is two-way at query
-- time (a group of equivalent spellings), so "machine learning" also finds ML.
INSERT INTO `search_aliases` (`term`, `expansions_json`, `updated_at`, `updated_by`) VALUES
  ('ml', '["machine learning"]', 1790121601000, NULL),
  ('genai', '["generative ai"]', 1790121601000, NULL),
  ('ctf', '["capture the flag"]', 1790121601000, NULL);
