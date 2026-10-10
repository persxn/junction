-- v0.9.1: repairs for what the v0.9.0 installer did on a fresh machine.
--
-- 1. Both sign-in pages moved. Devfolio: `https://devfolio.co/login` now answers 404 and
--    `/signin` redirects to a modal on `/discover?auth=signin`, which is where the
--    sign-in window has to open (the shell treats leaving that query as landing).
UPDATE `sources`
SET `config_json` = json_set(
      `config_json`,
      '$.session.loginUrl',
      'https://devfolio.co/discover?auth=signin'
    ),
    `updated_at` = 1791676800000
WHERE `key` = 'devfolio'
  AND json_extract(`config_json`, '$.session.loginUrl') = 'https://devfolio.co/login';
--> statement-breakpoint
-- Unstop's sign-in moved too: `/login` renders its "wrong turn" page, and the
-- Angular app routes sign-in to `/auth/login`.
UPDATE `sources`
SET `config_json` = json_set(`config_json`, '$.session.loginUrl', 'https://unstop.com/auth/login'),
    `updated_at` = 1791676800000
WHERE `key` = 'unstop'
  AND json_extract(`config_json`, '$.session.loginUrl') = 'https://unstop.com/login';
--> statement-breakpoint
-- 2. The scraping transport asked for gzip and never decoded it, so the first
--    live run of every source whose server compresses (CTFtime, Devfolio) failed
--    as SCHEMA_CHANGED and §7.7 paused the source. The transport decodes now;
--    switch back on exactly the sources that bug switched off — disabled, with
--    SCHEMA_CHANGED as the last error and no successful run ever recorded — and
--    clear the failure so the next run starts clean. A source an administrator
--    turned off after it once worked is left alone.
UPDATE `sources`
SET `is_enabled` = 1,
    `updated_at` = 1791676800000,
    `version` = `version` + 1
WHERE `is_enabled` = 0
  AND `compliance_status` IN ('APPROVED', 'APPROVED_WITH_LIMITS')
  AND `id` IN (
    SELECT `source_id` FROM `source_state`
    WHERE `last_error_kind` = 'SCHEMA_CHANGED' AND `last_success_at` IS NULL
  );
--> statement-breakpoint
UPDATE `source_state`
SET `consecutive_failures` = 0,
    `backoff_until` = NULL,
    `next_due_at` = 0
WHERE `last_error_kind` = 'SCHEMA_CHANGED'
  AND `last_success_at` IS NULL
  AND `source_id` IN (SELECT `id` FROM `sources` WHERE `is_enabled` = 1);
