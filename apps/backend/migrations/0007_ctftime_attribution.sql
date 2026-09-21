-- WP-09b: CTFtime's attribution line (D-32) and its path allowance (§7.2).
--
-- 0006 seeded `attribution_text` as 'CTF data provided by CTFtime'. D-32 and
-- WP-09b fix the wording that is shown on every event and in About:
-- "Event data from CTFtime (ctftime.org)". Fixed by UPDATE-by-key, as 0006's
-- header asks, and never by editing 0006: an installed database has already
-- applied it.
--
-- Every other CTFtime column was checked against what the adapter's run uses.
-- APPROVED_WITH_LIMITS, cadence 30, manual floor 10, delay 10000 ms and 6
-- requests per run already agree. `allowed_paths_json` did not: the grammar
-- (src/domain/scraping/paths.ts) is prefix-only, so `ctftime.org/api/v1/events/`
-- also authorized `/api/v1/events/3417/anything/`, and the `{id}/` entry added
-- nothing. A denial of any segment below the id closes that; a denial always
-- wins. The listing (`/api/v1/events/?limit=…`) has no slash after its query
-- and is not matched by it.
--
-- `version` is not touched: it is the admin API's optimistic-concurrency
-- counter (§6.1), not a schema version.

UPDATE `sources`
SET `attribution_text` = 'Event data from CTFtime (ctftime.org)',
    `allowed_paths_json` = '["ctftime.org/api/v1/events/","ctftime.org/api/v1/events/{id}/","!ctftime.org/api/v1/events/{id}/{below}"]',
    `updated_at` = 1790035200000
WHERE `key` = 'ctftime';
