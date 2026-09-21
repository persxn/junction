-- WP-12: the Devfolio row, updated by key (0006's header asks for exactly this).
-- Enabled now that its adapter exists. One listing + up to 10 details per run.
-- config_json.hosts names the two host forms URL import (WP-14) dispatches on;
-- deniedHosts is checked by the adapter before any request is formed.
-- `version` is not touched.
UPDATE `sources`
SET `adapter` = 'DEVFOLIO',
    `config_json` = '{"baseUrl":"https://devfolio.co","listingPath":"/hackathons","hosts":["devfolio.co","*.devfolio.co"],"deniedHosts":["api.devfolio.co"],"maxDetailsPerRun":10,"defaultTimeZone":"Asia/Kolkata"}',
    `is_enabled` = 1,
    `cadence_minutes` = 15,
    `manual_min_interval_minutes` = 5,
    `min_delay_ms` = 3000,
    `max_requests_per_run` = 11,
    `allowed_paths_json` = '["devfolio.co/hackathons","*.devfolio.co/","!api.devfolio.co"]',
    `attribution_text` = 'Hackathon data from Devfolio',
    `trust_rank` = 60,
    `compliance_status` = 'APPROVED_WITH_LIMITS',
    `compliance_notes` = 'APPROVED_WITH_LIMITS for server-rendered public pages only: devfolio.co/hackathons (one listing request per run) and the per-hackathon <slug>.devfolio.co pages (a detail only when a listing item changed, at most 10 per run), each read from its embedded __NEXT_DATA__ JSON. Every subdomain is its own host with its own robots.txt. NEVER api.devfolio.co - undocumented and private; refused by the adapter before the transport (SOURCE_HOST_FORBIDDEN) and by the ! entry in allowed_paths_json. The Terms of Use (29 Dec 2020) prohibit interference, impersonation, unlawful use and DDoS and are silent on scraping or automated access; silence is not permission, and the courtesy permission e-mail (U5) is still outstanding. Participants, judges, mentors, settings.contact_email and every social handle except settings.site are dropped at the adapter boundary (D-29). Signed-in reading with the professor''s own session is R74 (WP-14).',
    `updated_at` = 1790035200000
WHERE `key` = 'devfolio';
