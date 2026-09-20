-- WP-09a: the five source rows of D-26 (ARCHITECTURE.md §7.2's table,
-- ADR-0016, docs/research/source-feasibility.md).
--
-- A data migration with fixed UUID literals rather than code that runs at
-- startup, for three reasons. The ids are stable across installs, so a later
-- adapter work package can upsert its row by key without inventing one. The
-- verdicts are policy a human reached by reading each site's Terms, so they
-- belong in a reviewed file, not in a seeding routine nobody reads. And a
-- verdict that changes — Unstop, once U3 is closed — is then one more data
-- migration rather than an edit to this one.
--
-- Later adapter work packages UPDATE their row by `key` and never touch
-- `version`: `sources.version` is §6.1's optimistic-concurrency counter for the
-- admin API, not a schema version.
--
-- `allowed_paths_json` entries are HOST-QUALIFIED (`host[/prefix]`,
-- `*.host[/prefix]`, `{...}` for one path segment, a leading `!` to deny). A
-- bare path authorizes nothing, because the host is the part that decides whose
-- server gets the request. See `src/domain/scraping/paths.ts`.
--
-- `compliance_status` is NOT settable through the API (§10.2 + WP-09a): it
-- moves only by a migration like this one, after somebody has read the Terms.

INSERT INTO `sources` (
  `id`, `key`, `name`, `adapter`, `config_json`, `is_enabled`,
  `cadence_minutes`, `manual_min_interval_minutes`, `min_delay_ms`,
  `max_requests_per_run`, `allowed_paths_json`, `attribution_text`,
  `trust_rank`, `compliance_status`, `compliance_notes`,
  `compliance_reviewed_at`, `compliance_reviewed_by`,
  `created_at`, `updated_at`, `version`
) VALUES (
  '01a0bc1c-d000-7000-8000-000000000001',
  'ctftime',
  'CTFtime',
  'CTFTIME_API',
  '{"baseUrl":"https://ctftime.org","listingLimit":100}',
  1,
  30,
  10,
  10000,
  6,
  '["ctftime.org/api/v1/events/","ctftime.org/api/v1/events/{id}/"]',
  'CTF data provided by CTFtime',
  40,
  'APPROVED_WITH_LIMITS',
  'API only, never HTML scraping. CTFtime''s API page states the terms of use: "This API is provided for data analysis and mobile applications only." and "You can not use this API to run CTFtime clones - most of the CTFtime data is moderated by humans, please, respect their time." robots.txt sets Crawl-delay: 10 and Content-signal: search=yes, ai-train=no, use=reference - so this data is never used to train a model and is never republished outside the app (D-32). Paths /api/v1/events/ and /api/v1/events/{id}/ only.',
  1789862400000,
  'WP-02 source feasibility review, 20 Sep 2026 (docs/research/source-feasibility.md §1)',
  1789862400000,
  1789862400000,
  1
);
--> statement-breakpoint
INSERT INTO `sources` (
  `id`, `key`, `name`, `adapter`, `config_json`, `is_enabled`,
  `cadence_minutes`, `manual_min_interval_minutes`, `min_delay_ms`,
  `max_requests_per_run`, `allowed_paths_json`, `attribution_text`,
  `trust_rank`, `compliance_status`, `compliance_notes`,
  `compliance_reviewed_at`, `compliance_reviewed_by`,
  `created_at`, `updated_at`, `version`
) VALUES (
  '01a0bc1c-d000-7000-8000-000000000002',
  'clist',
  'CLIST',
  'CLIST_API',
  '{"baseUrl":"https://clist.by","apiKeySetting":"sources.clist.apiKey"}',
  0,
  30,
  10,
  6000,
  4,
  '["clist.by/api/v4/"]',
  'Contest data provided by CLIST',
  20,
  'APPROVED_WITH_LIMITS',
  'DISABLED until U4 is done: the v4 API requires an account and key, and nobody has created one. CLIST''s Terms (updated 8 Dec 2025) permit "a free API intended mainly for personal, educational and community projects" on condition that we "respect any documented or communicated rate limits" (10 requests/minute), "implement reasonable caching", keep credentials secret and "clearly attribute CLIST as the source of contest data". Never resell or redistribute the raw data. robots.txt disallows /api/ for unauthenticated crawlers while the Terms invite authenticated API use; an API key is authorized access, and a human should confirm that reading.',
  1789862400000,
  'WP-02 source feasibility review, 20 Sep 2026 (docs/research/source-feasibility.md §2)',
  1789862400000,
  1789862400000,
  1
);
--> statement-breakpoint
INSERT INTO `sources` (
  `id`, `key`, `name`, `adapter`, `config_json`, `is_enabled`,
  `cadence_minutes`, `manual_min_interval_minutes`, `min_delay_ms`,
  `max_requests_per_run`, `allowed_paths_json`, `attribution_text`,
  `trust_rank`, `compliance_status`, `compliance_notes`,
  `compliance_reviewed_at`, `compliance_reviewed_by`,
  `created_at`, `updated_at`, `version`
) VALUES (
  '01a0bc1c-d000-7000-8000-000000000003',
  'devfolio',
  'Devfolio',
  'DEVFOLIO',
  '{"baseUrl":"https://devfolio.co","listingPath":"/hackathons"}',
  0,
  15,
  5,
  3000,
  20,
  '["devfolio.co/hackathons","*.devfolio.co","!api.devfolio.co"]',
  'Hackathon data from Devfolio',
  60,
  'APPROVED_WITH_LIMITS',
  'DISABLED until the Devfolio adapter lands (WP-12). Server-rendered public pages only: devfolio.co/hackathons and the per-hackathon <slug>.devfolio.co subdomains, which embed the hackathon object as page JSON. NEVER api.devfolio.co - it is undocumented and private, and the deny entry in allowed_paths_json enforces that against the *.devfolio.co wildcard. The Terms of Use (29 Dec 2020) prohibit interference, impersonation, unlawful use and DDoS, and say nothing at all about scraping or automated access; silence is not permission, so a courtesy permission e-mail is still owed (U5). Drop participants, judges and settings.contact_email at the adapter boundary (D-29).',
  1789862400000,
  'WP-02 source feasibility review, 20 Sep 2026 (docs/research/source-feasibility.md §3)',
  1789862400000,
  1789862400000,
  1
);
--> statement-breakpoint
INSERT INTO `sources` (
  `id`, `key`, `name`, `adapter`, `config_json`, `is_enabled`,
  `cadence_minutes`, `manual_min_interval_minutes`, `min_delay_ms`,
  `max_requests_per_run`, `allowed_paths_json`, `attribution_text`,
  `trust_rank`, `compliance_status`, `compliance_notes`,
  `compliance_reviewed_at`, `compliance_reviewed_by`,
  `created_at`, `updated_at`, `version`
) VALUES (
  '01a0bc1c-d000-7000-8000-000000000004',
  'unstop',
  'Unstop',
  'UNSTOP',
  '{}',
  0,
  15,
  5,
  3000,
  20,
  '[]',
  'Competition data from Unstop',
  60,
  'MANUAL_IMPORT_ONLY',
  'MANUAL IMPORT ONLY until U3 is done. unstop.com/legal/terms-of-use returned 200 with a 349-character Angular shell - the Terms are rendered client-side and could not be read, and rendering them would need a headless browser. The Terms are therefore UNREAD, and an unread Terms page is not permission. robots.txt is encouraging but is not a substitute: it allows /competitions/, /hackathons/ and /api/public/*, and disallows the rest of /api/*, */register, /u/, /p/, /pf/. allowed_paths_json is deliberately EMPTY, so the gate refuses every request regardless of what an adapter asks for. If a human reads the Terms and they are silent or permissive, this becomes APPROVED_WITH_LIMITS in a later migration.',
  1789862400000,
  'WP-02 source feasibility review, 20 Sep 2026 (docs/research/source-feasibility.md §5)',
  1789862400000,
  1789862400000,
  1
);
--> statement-breakpoint
INSERT INTO `sources` (
  `id`, `key`, `name`, `adapter`, `config_json`, `is_enabled`,
  `cadence_minutes`, `manual_min_interval_minutes`, `min_delay_ms`,
  `max_requests_per_run`, `allowed_paths_json`, `attribution_text`,
  `trust_rank`, `compliance_status`, `compliance_notes`,
  `compliance_reviewed_at`, `compliance_reviewed_by`,
  `created_at`, `updated_at`, `version`
) VALUES (
  '01a0bc1c-d000-7000-8000-000000000005',
  'devpost',
  'Devpost',
  'DEVPOST',
  '{}',
  0,
  15,
  5,
  3000,
  20,
  '[]',
  'Hackathon data from Devpost',
  60,
  'MANUAL_IMPORT_ONLY',
  'MANUAL IMPORT ONLY, permanently unless written permission arrives. Devpost''s Terms of Service (5 Dec 2025) prohibit, verbatim: "Uses manual or automated software, devices, scripts robots, or other means or processes to access, ''scrape,'' ''crawl'' or ''spider'' the Site, User Content (including User Profiles and Team Pages), or any related data or information". A permissive robots.txt does not override that. No adapter, no scheduled run, and URL import is refused for this domain (D-30): the manual event form opens with the link attached instead. allowed_paths_json is empty.',
  1789862400000,
  'WP-02 source feasibility review, 20 Sep 2026 (docs/research/source-feasibility.md §4)',
  1789862400000,
  1789862400000,
  1
);
--> statement-breakpoint
-- One health row per source, due immediately and with no failure history.
INSERT INTO `source_state` (`source_id`, `next_due_at`, `consecutive_failures`)
SELECT `id`, 1789862400000, 0 FROM `sources`;
