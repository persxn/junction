-- pre-M2b / WP-09b Q1: allowed_paths_json supports a trailing `$`.
--
-- 0007 closed CTFtime's prefix-only allowance with a denial of any segment
-- below the event id, because the grammar had no end anchor. It has one now:
-- a trailing `$` ends the path (a query string may still follow), so the two
-- entries say exactly what §7.2 means — the listing and one event, nothing
-- below either — and the workaround denial goes.
UPDATE `sources`
SET `allowed_paths_json` = '["ctftime.org/api/v1/events/$","ctftime.org/api/v1/events/{id}/$"]',
    `updated_at` = 1790899200000
WHERE `key` = 'ctftime';
