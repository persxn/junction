# pre-M2b — Ingestion & search corrections

Status: **PARTIAL** — all ten build groups are done, one commit each (`4fd2299` … `577e32e`), with every
owed test written and `pnpm verify` green. Three acceptance lines are not met: R88's new perf scenario is
**94 ms against 50 ms** (§3), `pnpm verify` is **~137 s against 120 s** (unchanged cause, pre-M2a Q1), and
the owed live runs are **still owed** because `scraper.contactEmail` is not set on the dev database (§5).

## 1. What each group built

| # | Ruling | Built | Commit |
|---|---|---|---|
| 1 | R75 | Every request is tagged `anonymous`/`signed-in` (debug log). The session is split from the API key (`SourceCredential.kind`) and is attached only to a `signed-in` request made on a **targeted view** (`client.signedInView()`), which the orchestrator opens only for a *stored* event's detail page outside `STARTUP_CATCHUP` — listing walks and new events are always anonymous. Budget `config_json.session.signedIn {maxRequestsPerRun: 5, minIntervalMs: 10000}` (migration 0016), enforced in the client through a run-wide ledger shared by every view: the 6th is refused (`SIGNED_IN_BUDGET_SPENT`), the spacing is waited out. `detail-refresh` now carries the credential (WP-11 known issue). | `4fd2299` |
| 2 | R80, R79 | A 401, or a 403 whose body is a sign-in page, on a request that carried the key or the session → `HTTP_4XX` with `credential`, never `BLOCKED`, no backoff, no R79 count. A refused session is marked expired and **the same page is re-read anonymously**; a refused key is `EXPIRED` (401) / `INVALID` (login page) and not sent again until a new one is stored. Three consecutive site blocks → `compliance_status = BLOCKED`, `is_enabled = false`, earlier verdict kept; an admin `PATCH isEnabled: true` restores it (audited). Each state is one standing sentence (`source_state.notice`) that outranks the outcome's on Source status and is cleared by the act that answers it. Migration 0017. | `7d3b1df` |
| 3 | R77 | Gate logic existed (WP-11). Added the tests R77 lists, a client test that a session does **not** unlock the exemption, the once-per-run log line, a route test that every spelling of `config_json` is a 400, and migration 0018 naming the architect as reviewer (2026-09-22). | `70d18b8` |
| 4 | R81 | Already enforced by WP-15a's SQL; the three copies of "which precisions allow a distance" are now one domain constant (`DISTANCE_PRECISIONS`, `hasMeasurableLocation`). New test: a STATE event 35 km from campus. | `0606711` |
| 5 | R82 | Filter `IN_TOWNS`; rebuilt; manifest and `mini.db` regenerated. New `tools/gazetteer/src/probe.ts` for the before/after (§4). | `5b4f432` |
| 6 | R85 | `finish()` no longer lowers an epoch or an ISO instant with `Z`/offset. A CTFtime event with no usable date was already invalid (WP-09b, `run.test` "invalid-dates.json"). | `5e00f6e` |
| 7 | R87 | `categories/domain/tags.ts` (seeded TECHNOLOGY set, else THEME) + `tags-repo.ts`; the classification pass that link/merge/unmerge/reclassify all end in replaces the event's `SOURCE_TAG` rows. `events.tags_text` feeds the FTS `tags` column (view + triggers rewritten, migration 0019); existing events are backfilled by one queued `categories:reclassify` run. | `044b3c4` |
| 8 | R88 | `events.top_trust_rank` written by `resolver.apply` (link/merge/unmerge), backfilled (0020); TRUSTED_SOURCE reads it. `perf:search` gains **first page (R88)**. | `28bf779` |
| 9 | WP-16a Q1 | `EventQuery.recurringOnly` (implies `includeRecurring`), in the base filter so facets follow; the Calendar tab uses it. | `da6bc30` |
| 10 | small | `$` end anchor + CTFtime anchored (0021) · CTFtime `detailPolicy: 'never'` · `scrape_runs.kind` + a DETAIL_REFRESH row per pass (0022) · `domain/jobs/schedule.ts` · URL-import commit diffs against the preview. | `577e32e` |

## 2. Tests and commands

| Check | Result |
|---|---|
| `pnpm verify` | green, **~137 s** (format 7 · lint 26 · typecheck ~1 · test 102) · **3 197 tests** (was 3 137) |
| `pnpm test:a11y` | green, 23 tests (Discover + the import form changed) |
| `pnpm audit:deps` | no known vulnerabilities · **no dependency added or changed** |
| `pnpm perf:search` | see §3 — exits non-zero on the R88 scenario |
| Rust checks | not run: nothing under `src-tauri` changed |

The prompt's named tests: `scraping/signed-in.test.ts` (R75: zero signed-in on a scheduled listing, 6th
refused, ≥ 10 s apart under an advancing clock, catch-up, detail-refresh) · `scraping/standing.test.ts` (R80
401 keyed / login-page 403 signed-in, R79 2-then-3) · `domain/scraping/gate.test.ts` + `http/exemption.test.ts`
(R77) · `search/filters.test.ts` (R81) · `categories/tags.test.ts` (R87, Devfolio + CTFtime goldens through the
real linker) · `events/trust.test.ts` (R88) · gate `$` tests (`/api/v1/events/{id}/$` refuses `/1/extra`).

## 3. R88 — measured, and the miss

20 000 synthetic events, p95, this machine (budget = §8.3 halved):

| Scenario | Before | After | Budget |
|---|---|---|---|
| filters + text | 51.3 (FAIL) | **36.8** | < 50 |
| unfiltered feed (no facets) | 62.6 | 43.0 | — |
| **first page (R88)** — unfiltered, with facets | — | **94.3 (FAIL)** | < 50 |
| facets (added) | 51.6 | 51.2 | < 75 |

Profiled per statement: the ranked page is ~40 ms, of which ~12 ms is the per-user interest-category lookup
R88 keeps; the facet tally is ~50 ms (materializing ~19 k rows 20 ms, the type×mode×state grid 21 ms, the
category join 11 ms). Folding the grid into one `count(*)` per group saves only ~6 ms, so local SQL tuning
cannot reach 50 ms — see question 1. Nothing was tuned speculatively.

## 4. Gazetteer (R82)

| | Before | After |
|---|---|---|
| places (all) | 588 362 | **37 538** |
| India rows | 557 995 | **7 171** (7 140 populated + seats) |
| alias keys | 145 933 | 134 036 |
| admin1 | 3 865 | 3 865 |
| file | 71 843 840 B (68.5 MB) | **9 940 992 B (9.48 MB)** |
| `mini.db` | 35 places, 53 248 B | 25 places, 53 248 B |

Probe (every institution-seed city × with state / with country / alone = 207): before CITY 202 · UNKNOWN 4 ·
STATE 1; after CITY 200 · UNKNOWN 5 · STATE 1 · COUNTRY 1. **5 changed:** Allahabād, Punjab **STATE → CITY**
(Prayagraj — the tie-break works again) · Hubli → the Hubballi row (still CITY) · **Kurukshetra ×3 regressed**
(CITY → STATE / COUNTRY / UNKNOWN): its only GeoNames row has population 0 and is not a seat. NIT Kurukshetra
itself still resolves through its seed row. The probe also exposed **seed errors**: IIT and IIIT Dharwad are
seeded in *Maharashtra* (Karnataka) and MNNIT / IIIT Allahabad in *Punjab* (Uttar Pradesh) — not fixed (WP-29).

## 5. Owed live runs

`scraper.contactEmail` has **no row** on `%LOCALAPPDATA%\CompIntel-dev\data\app.db` (read-only check). Not
set, per the prompt. **Still owed:** WP-09b's CTFtime smoke, WP-12's Devfolio smoke, WP-13's `unstop:capture`
(fixture replacement + golden review); `clist:smoke` waits on U4.

## 6. Goldens regenerated (R62)

`search/plans/{empty, text-and-filters, distance-with-online, dates-and-registration, injection-text}` —
each gained exactly `"recurringOnly": false`, the new plan field. **No adapter golden changed**: R85's fix
reaches no recorded fixture, because CTFtime and CLIST already passed UTC explicitly to dodge the bug.

## 7. Deviations and minor decisions

1. **No adapter asks for a signed-in read yet.** R75 allows (a) account pages, which nothing reads yet, and
   (b) a stored event's detail page *whose public page lacks a field*; no capture shows which field that is.
   The mechanism is built and tested with a test adapter; URL import reads anonymously. (Question 2.)
2. Session failure → re-read the same page anonymously at once (R80's "fall back to public reading").
3. 401 on a key → `EXPIRED`; a login page on a key → `INVALID`. A refused-key run is `BLOCKED_BY_POLICY`
   (the same state as WP-11's missing key) with `error_kind HTTP_4XX`.
4. R79 counts only finished runs the site answered with a block; gate refusals and skipped runs neither add
   nor reset. A source a *person* marked BLOCKED is not un-blocked by the switch (only R79's are).
5. R87: origin is the existing `SOURCE_TAG` value; tags > 40 chars are dropped; CLIST's resource host
   (e.g. `codeforces.com`) becomes a THEME tag, as the ruling's "each candidate's source tags" reads.
   Interest tags now match event tags **by normalized name across kinds** — otherwise TAG_MATCH could never
   fire, since interests are `INTEREST` rows and event tags are `TECHNOLOGY`/`THEME`.
6. `$` ends the *path*; a query string may still follow (CTFtime's listing has one).
7. URL-import diff: only fields the professor *stated* can become overrides; dates compare at the precision
   the form states (a day, or a minute). `edited` stays in the contract, accepted and ignored.
8. **Two faults the diff exposed, fixed:** the form showed prefilled times as a UTC wall-clock (09:00 IST
   read as 03:30), and typed dates were normalized with an *assumed* UTC zone at lowered precision.
9. `Geocoder`/`openGazetteer` are exported from `@compintel/backend` for the probe tool.

## 8. Questions for the architect

1. **R88's 50 ms.** Options: (a) cache the unfiltered first page + facets per user, invalidated on ingest,
   hide/save and settings; (b) maintained facet-count tables; (c) budget this scenario at 100 ms on the build
   machine and re-measure on the 8 GB host (WP-31); (d) keep the interest boosts out of the first page's SQL
   score. Recommendation: (c) now, (a) if WP-31 confirms the miss.
2. Which field does a signed-in Devfolio/Unstop detail page carry that the public one lacks? Until named, R74
   sessions are effectively unused by scheduled runs.
3. Kurukshetra under R82: accept, or keep every institution-seed city regardless of population?
4. The four mis-stated seed states (§4): a data migration now, or WP-29?
5. pre-M2a Q1 (Argon2id cost in tests) is still what stands between verify and 120 s.

## 9. Known issues / tech debt

- A refused or missing key still **fails the scheduler job** (the job layer throws on BLOCKED_BY_POLICY),
  so the *job* backs off although the source does not — pre-existing since WP-11; left for the architect.
- `top_trust_rank` is recomputed on link/merge/unmerge only; a migration that changes a source's
  `trust_rank` must backfill it (0020's UPDATE is the template).
- The resolver labels every override's date precision `DATETIME` (WP-10), so a typed date-only deadline
  shows a time on the event; the record keeps `DATE`.
- `dates.ts` is at exactly 400 lines; `repository.ts` 391, `sources/service.ts` 388, `polite-client.ts` 381.
- drizzle-kit's table rebuild selected new columns from the old table twice (0017, 0022); fixed by hand.

## 10. Files the architect should review

1. `apps/backend/src/scraping/http/polite-client.ts` + `attempt-rules.ts` (R75/R80 in the client)
2. `apps/backend/src/scraping/standing.ts` + `finish.ts` (R79/R80 at run end)
3. `apps/backend/migrations/0019_event_tags_text.sql` (FTS view/triggers + backfill)
4. `apps/backend/src/modules/events/import/write.ts` (`editedAgainstPreview`)
5. `tools/perf/search/src/scenarios.ts` (the R88 scenario)

## 11. Next step

M2 — `prompts/M2/WP-17.md`, after answers to questions 1 and 2. The owed live runs need the owner's own
address in `scraper.contactEmail` first.
