-- pre-M2b / ruling R77: CLIST's robots exemption is accepted.
--
-- 0009 seeded config_json.robotsExemption as WP-11's *proposed* ruling, naming
-- the WP-02 feasibility review as its reviewer. R77 accepts it and names the
-- architect (M1 review, 22 Sep 2026) as the reviewer; the owner re-signs it when
-- U4's key exists. Only the two review fields change — the paths and the reason
-- stay exactly as 0009 wrote them — and compliance_notes stops calling it
-- "proposed".
--
-- config_json is seed-only: the admin API has no field that writes it (R77), so
-- a migration is the only way this text can change.
UPDATE `sources`
SET `config_json` = json_set(
      `config_json`,
      '$.robotsExemption.reviewedBy', 'architect, M1 review (ruling R77); the owner re-signs when the U4 key is created',
      '$.robotsExemption.reviewedAt', '2026-09-22'
    ),
    `compliance_notes` = replace(
      `compliance_notes`,
      'config_json.robotsExemption records the reviewed reading that an API key is authorized access (proposed ruling, WP-11).',
      'config_json.robotsExemption records the reviewed reading that an API key is authorized access (ruling R77, accepted 22 Sep 2026).'
    ),
    `updated_at` = 1790899200000
WHERE `key` = 'clist'
  AND json_extract(`config_json`, '$.robotsExemption') IS NOT NULL;
