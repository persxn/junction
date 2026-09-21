-- WP-11: event_series.series_key (the upsert key for series detection) and the
-- CLIST source row. The first two statements are drizzle-kit's; the UPDATE is hand-written.
ALTER TABLE `event_series` ADD `series_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `event_series_series_key_uq` ON `event_series` (`series_key`);
--> statement-breakpoint
-- WP-11: the CLIST row, updated by key (0006's header asks for exactly this).
-- Enabled: with no key it makes zero requests and records BLOCKED_BY_POLICY
-- ("CLIST API key not set (U4)") while staying on its cadence, so storing the
-- key is all it takes to start. Paths narrowed to the two v4 endpoints. The
-- credential's shape lives in config_json.auth, its values in two secret
-- settings. config_json.robotsExemption is the seed-only answer to robots
-- disallowing /api/ (proposed ruling, see docs/handoff/WP-11.md).
-- trust_rank 20 is the lowest of any source (aggregator, §7.5). `version` is not touched.
UPDATE `sources`
SET `adapter` = 'CLIST_API',
    `config_json` = '{"baseUrl":"https://clist.by","auth":{"header":"Authorization","valueTemplate":"ApiKey {username}:{key}","usernameSetting":"sources.clist.apiUsername","keySetting":"sources.clist.apiKey","missingDetail":"CLIST API key not set (U4)"},"robotsExemption":{"paths":["clist.by/api/v4/contest/","clist.by/api/v4/resource/"],"reason":"robots.txt disallows /api/ for crawlers; CLIST''s Terms (8 Dec 2025) offer a free API to authenticated key holders for personal, educational and community projects. Applies only to the two API paths and only with the key.","reviewedBy":"WP-02 source feasibility review (docs/research/source-feasibility.md §2.3); proposed ruling pending in WP-11 handoff","reviewedAt":"2026-09-20"}}',
    `is_enabled` = 1,
    `cadence_minutes` = 30,
    `manual_min_interval_minutes` = 10,
    `min_delay_ms` = 6000,
    `max_requests_per_run` = 4,
    `allowed_paths_json` = '["clist.by/api/v4/contest/","clist.by/api/v4/resource/"]',
    `attribution_text` = 'Contest data provided by CLIST',
    `trust_rank` = 20,
    `compliance_status` = 'APPROVED_WITH_LIMITS',
    `compliance_notes` = 'APPROVED_WITH_LIMITS, key required (U4): the v4 API needs an account and an API key; with no key the source records BLOCKED_BY_POLICY and makes no request. CLIST''s Terms (updated 8 Dec 2025): "CLIST may provide a free API intended mainly for personal, educational and community projects." We agree to "respect any documented or communicated rate limits" ("Standard request limit is 10 per minute"; here 6 s between requests, 4 per run), to "implement reasonable caching to avoid repeated requests for the same data within a short time", to keep credentials secret, and to "clearly attribute CLIST as the source of contest data". We never "resell, repackage or redistribute CLIST''s raw data", never use website sessions instead of a key, and never scrape clist.by HTML. robots.txt disallows /api/; config_json.robotsExemption records the reviewed reading that an API key is authorized access (proposed ruling, WP-11).',
    `updated_at` = 1790035200000
WHERE `key` = 'clist';
