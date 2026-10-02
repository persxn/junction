-- pre-M2b / ruling R75: signed-in reads are targeted, not bulk.
--
-- The two sources that may hold the professor's session (R74: Devfolio and
-- Unstop) get R75's allowance written into their `config_json.session` block:
-- at most five signed-in requests a run, at least ten seconds apart. The client
-- enforces it (`scraping/http/polite-client.ts`); the numbers live here so that
-- widening them — which R75 says the owner may do — is a migration somebody
-- reviewed, not a constant somebody changed.
--
-- json_patch merges into the existing session block (RFC 7396), so the header,
-- the settings it names, the login URL and the hosts are left as 0012 wrote them.
UPDATE `sources`
SET `config_json` = json_patch(
      `config_json`,
      '{"session":{"signedIn":{"maxRequestsPerRun":5,"minIntervalMs":10000}}}'
    ),
    `updated_at` = 1790899200000
WHERE `key` IN ('devfolio', 'unstop')
  AND json_extract(`config_json`, '$.session') IS NOT NULL;
