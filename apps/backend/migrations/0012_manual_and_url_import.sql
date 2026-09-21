-- WP-14: the two rows an event can come from without a listing — `manual`
-- (a professor typed it in) and `url-import` (one page, read once, because a
-- professor pasted its link) — plus the `config_json.hosts` URL import
-- dispatches on and the `config_json.session` block of R74/D-34.
--
-- Hand-written and updated by key, as 0006's header asks. No schema changes: a
-- session is stored in secret settings like WP-11's API key, not in a column.
--
-- Neither new row can ever be scheduled. `scrape:<source>` jobs come from the
-- intersection of the adapter registry and the enabled, approved rows, and
-- `MANUAL`/`URL_IMPORT` are never registered (WP-09a, `sources/registry.ts`).
-- `url-import` is nevertheless `is_enabled = 1`, because that flag is what the
-- compliance gate reads on its one user-initiated request and what an
-- administrator switches URL import off with; `manual` is disabled because it
-- makes no request at all, ever.
--
-- `manual` carries `max_requests_per_run = 1` only because the column's CHECK
-- insists on at least one; it makes no request, having neither an adapter nor a
-- path it is allowed to reach (`allowed_paths_json` is empty).
--
-- `url-import`'s `allowed_paths_json` is empty on purpose. The host a
-- professor pastes is not knowable in advance, so the service supplies an
-- allowance of exactly that one host for exactly that one request. An empty
-- stored list means nothing else can borrow this row to reach anywhere.
INSERT INTO `sources` (
  `id`, `key`, `name`, `adapter`, `config_json`, `is_enabled`,
  `cadence_minutes`, `manual_min_interval_minutes`, `min_delay_ms`,
  `max_requests_per_run`, `allowed_paths_json`, `attribution_text`,
  `trust_rank`, `compliance_status`, `compliance_notes`,
  `compliance_reviewed_at`, `compliance_reviewed_by`,
  `created_at`, `updated_at`, `version`
) VALUES (
  '01a0bc1c-d000-7000-8000-000000000006',
  'manual',
  'Typed in by hand',
  'MANUAL',
  '{"hosts":[]}',
  0,
  1440,
  1,
  3000,
  1,
  '[]',
  NULL,
  90,
  'APPROVED',
  'Not a source on the internet: the row every manually entered event belongs to, so it has provenance like any other (§6.2). It is never scheduled, has no adapter, and makes no request of any kind. Its trust rank is the highest of any source because a professor stating a fact outranks a scraped page; every field they supply is additionally written as an event_overrides row, which beats every claim whatever the rank (§7.5).',
  1790035200000,
  'WP-14',
  1790035200000,
  1790035200000,
  1
);--> statement-breakpoint
INSERT INTO `sources` (
  `id`, `key`, `name`, `adapter`, `config_json`, `is_enabled`,
  `cadence_minutes`, `manual_min_interval_minutes`, `min_delay_ms`,
  `max_requests_per_run`, `allowed_paths_json`, `attribution_text`,
  `trust_rank`, `compliance_status`, `compliance_notes`,
  `compliance_reviewed_at`, `compliance_reviewed_by`,
  `created_at`, `updated_at`, `version`
) VALUES (
  '01a0bc1c-d000-7000-8000-000000000007',
  'url-import',
  'Imported from a link',
  'URL_IMPORT',
  '{"hosts":[]}',
  1,
  1440,
  1,
  3000,
  1,
  '[]',
  NULL,
  70,
  'APPROVED_WITH_LIMITS',
  'One page, once, because a professor pasted its link (§7.1, D-30). Never scheduled and never crawled: robots.txt for that host is read first, exactly one request is made, HTML only, no link is followed and no second page is ever fetched. The domain is dispatched first, so a link belonging to an approved source goes to that source''s adapter and a link belonging to a MANUAL_IMPORT_ONLY or BLOCKED source (Devpost) is refused with no request at all. Its trust rank sits above the registration platforms because the page is usually the organizer''s own and a person chose it deliberately, and below a typed-in entry.',
  1790035200000,
  'WP-14',
  1790035200000,
  1790035200000,
  1
);--> statement-breakpoint
INSERT INTO `source_state` (`source_id`, `next_due_at`, `consecutive_failures`)
SELECT `id`, 1790035200000, 0 FROM `sources`
WHERE `key` IN ('manual', 'url-import');--> statement-breakpoint
-- `hosts` is what WP-14's dispatcher matches a pasted link against. Devfolio
-- (0010) and Unstop (0011) already carry theirs; these three did not, and
-- without them Devpost's MANUAL_IMPORT_ONLY verdict could not be applied to a
-- devpost.com link at all.
UPDATE `sources`
SET `config_json` = '{"baseUrl":"https://ctftime.org","listingLimit":100,"hosts":["ctftime.org","*.ctftime.org"]}',
    `updated_at` = 1790035200000
WHERE `key` = 'ctftime';--> statement-breakpoint
UPDATE `sources`
SET `config_json` = json_patch(`config_json`, '{"hosts":["clist.by","*.clist.by"]}'),
    `updated_at` = 1790035200000
WHERE `key` = 'clist';--> statement-breakpoint
UPDATE `sources`
SET `config_json` = '{"hosts":["devpost.com","*.devpost.com"]}',
    `updated_at` = 1790035200000
WHERE `key` = 'devpost';--> statement-breakpoint
-- R74/D-34: the two sources the owner may sign in to with their own account.
-- `session` names the header and the four settings the cookie and its state
-- live in; the cookie itself is a secret setting, never a column, never logged
-- and never exported. `hosts` here is a second, independent restriction on
-- where the header may be sent — the gate's allowed_paths_json still applies,
-- and `!api.devfolio.co` still wins.
UPDATE `sources`
SET `config_json` = json_patch(
      `config_json`,
      '{"session":{"header":"Cookie","cookieSetting":"sources.devfolio.sessionCookie","capturedAtSetting":"sources.devfolio.sessionCapturedAt","stateSetting":"sources.devfolio.sessionState","verifiedAtSetting":"sources.devfolio.sessionVerifiedAt","loginUrl":"https://devfolio.co/login","hosts":["devfolio.co","*.devfolio.co"]}}'
    ),
    `compliance_notes` = `compliance_notes` || ' Signed-in reading with the professor''s own session is enabled (R74/D-34): read-only GETs to devfolio.co and its sub-domains, under the same gate, robots, delay and caps; api.devfolio.co stays forbidden with or without a session.',
    `updated_at` = 1790035200000
WHERE `key` = 'devfolio';--> statement-breakpoint
UPDATE `sources`
SET `config_json` = json_patch(
      `config_json`,
      '{"session":{"header":"Cookie","cookieSetting":"sources.unstop.sessionCookie","capturedAtSetting":"sources.unstop.sessionCapturedAt","stateSetting":"sources.unstop.sessionState","verifiedAtSetting":"sources.unstop.sessionVerifiedAt","loginUrl":"https://unstop.com/login","hosts":["unstop.com","*.unstop.com"]}}'
    ),
    `compliance_notes` = `compliance_notes` || ' Signed-in reading with the professor''s own session is enabled (R74/D-34): read-only GETs to unstop.com and its sub-domains, under the same gate, robots, delay, caps and deny list; no /api/ path other than /api/public/ is ever requested, session or no session.',
    `updated_at` = 1790035200000
WHERE `key` = 'unstop';
