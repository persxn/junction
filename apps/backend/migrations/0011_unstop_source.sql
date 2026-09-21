-- WP-13: R73's review-due column (drizzle-kit) and the Unstop row (hand-written,
-- updated by key as 0006 asks). Enabled now that its adapter exists.
-- max_requests_per_run 12 = two listing pages (hackathons + competitions) + 10 details.
ALTER TABLE `sources` ADD `compliance_review_due_at` integer;--> statement-breakpoint
UPDATE `sources`
SET `adapter` = 'UNSTOP',
    `config_json` = '{"baseUrl":"https://unstop.com","hosts":["unstop.com","*.unstop.com"],"listingPath":"/api/public/opportunity/search-result","opportunities":["hackathons","competitions"],"perPage":30,"detailPath":"/api/public/competition/","maxDetailsPerRun":10,"defaultTimeZone":"Asia/Kolkata"}',
    `is_enabled` = 1,
    `cadence_minutes` = 15,
    `manual_min_interval_minutes` = 5,
    `min_delay_ms` = 3000,
    `max_requests_per_run` = 12,
    `allowed_paths_json` = '["unstop.com/api/public/","unstop.com/hackathons/","unstop.com/competitions/","!unstop.com/competitions/{slug}/register"]',
    `attribution_text` = 'Competition data from Unstop',
    `trust_rank` = 60,
    `compliance_status` = 'APPROVED_WITH_LIMITS',
    `compliance_notes` = 'R70 (owner, 21 Sep 2026): Unstop''s Terms are silent on automated access and carry no content-reuse or commercial-use restriction; robots.txt explicitly allows /hackathons/, /competitions/ and /api/public/* and disallows every other /api/*. APPROVED_WITH_LIMITS on those paths only; never */register, /u/, /p/, /pf/, /directory/user/*, /certificate-preview/*, /mentor/book-mentor/*, /api/get-attachment/* or any other /api/* - refused by the adapter before the transport (SOURCE_PATH_FORBIDDEN) and by robots. /api/public/* is undocumented (R71): zod-validated, SCHEMA_CHANGED on drift. The Terms'' proxy-cache bullet targets circumventing registration (R70). IP clause weighed in R72. No ''last updated'' date: pinned to footer version 9.18.2026.17.53, review by 21 Mar 2027 (R73). Registered-user and organiser contact data dropped at the adapter boundary (D-29).',
    `compliance_reviewed_at` = 1789948800000,
    `compliance_reviewed_by` = 'owner',
    `compliance_review_due_at` = 1805587200000,
    `updated_at` = 1790035200000
WHERE `key` = 'unstop';
