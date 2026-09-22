pre-M2b — Ingestion & search corrections: targeted signed-in reads, credential and block states, city-precision distance, gazetteer, tags, trust, owed smokes

Fresh session. Read ONLY: docs/PROGRESS.md · docs/handoff/M1-review.md (§2 and §4) · docs/handoff/pre-M2a.md ·
docs/handoff/WP-08b.md, WP-09a.md, WP-09b.md, WP-11.md, WP-14.md, WP-15a.md, WP-15b.md, WP-16a.md
("Questions" and "Known issues" only) · docs/ARCHITECTURE.md §7.2, §8.1, §8.3, §21 (**R53, R55, R60, R63,
R74, R75, R77, R79–R88** bind) · apps/backend/src/{scraping,adapters,sources,domain,modules/events,
modules/search,jobs}/** · packages/contracts/src/{search,sources,events}.ts · tools/gazetteer/**.

Why: M1's workers left fourteen questions; the architect answered them as R75–R90 (v1.1.14). This WP
turns those answers into code before M2 builds on the events model. **No rulings to write.**

BUILD — one commit per group, `pnpm verify` green after each:
1. **Signed-in reads are targeted (R75).** The PoliteHttpClient tags each request `anonymous` or
   `signed-in`. Scheduled listing walks are always anonymous. Signed-in is allowed only for the
   professor's own account pages and for detail pages of stored events whose public page lacks a field;
   ≤ 5 signed-in requests per source per run, ≥ 10 s apart, none during catch-up. Budget in `sources`
   config, enforced in the client, not the adapter.
2. **Credential failures (R80) and repeated blocks (R79).** A 401, or a 403 serving a login page, on a
   keyed or signed-in request → credential `EXPIRED`/`INVALID`, stop sending it, fall back to public
   reading, no backoff, not counted as BLOCKED. Three consecutive BLOCKED runs → `compliance_status =
   BLOCKED`, `is_enabled = false`, admin-only re-enable. Both become one sentence on Source status.
3. **CLIST exemption (R77).** `config_json.robotsExemption` honoured by the gate under R77's three
   conditions, with one log line per use; the admin API refuses writes to `config_json`.
4. **Distance needs city precision (R81).** STATE/COUNTRY-precision events are unknown location for
   distance filters, WITHIN_RADIUS, Nearby and the card text; `includeUnknown.location` decides.
5. **Gazetteer (R82).** Filter India to `population > 0` or PPLA–PPLA4/PPLC; rebuild; update the
   manifest; regenerate `mini.db`. Report row count and file size before/after, and re-run WP-08b's
   geocoding fixtures showing which moved from STATE to CITY.
6. **Offsets keep precision (R85).** Fix WP-08a's library; a CTFtime event with no usable date is
   invalid. Regenerate affected goldens deliberately and list each changed golden with the reason (R62).
7. **Event tags (R87).** The linker writes `event_tags` (origin SOURCE) from source tags via a seeded
   TECHNOLOGY/THEME map; backfill existing events; the tags filter and tag-interest boost now work.
8. **Trust denormalized (R88).** `events.top_trust_rank` maintained on link/merge/unmerge, backfilled;
   RELEVANCE reads it. Add the "unfiltered first page with facets" perf scenario (budget 50 ms here).
9. **Contest Calendar (WP-16a Q1).** `EventQuery.recurringOnly`; the Calendar tab uses it instead of the
   contest-types approximation; facets respect it.
10. **Small corrections:** `allowed_paths_json` supports a trailing `$` anchor (WP-09b Q1) · CTFtime gets
    adapter flag `detailPolicy: 'never'` — the listing carries every field (Q2) · `scrape_runs.kind`
    (LISTING | DETAIL_REFRESH) so `detail-refresh` records its work (WP-09a Q2) · `jobs/schedule.ts`
    moves to `src/domain/jobs/` · URL-import commit **diffs against the cached preview** instead of
    trusting the client's list of edited fields (WP-14 Q4).
11. **Owed live runs.** If `scraper.contactEmail` is set on the dev database (the owner's own address,
    R74), run WP-09b's CTFtime smoke, WP-12's Devfolio smoke and WP-13's `unstop:capture` (replace the
    synthetic fixtures in place, regenerate goldens, review the diff — WP-13 Q3), each within its prompt's
    request cap, and paste the request logs. If it is not set, **do not set it yourself**: list all three
    as still owed. `clist:smoke` stays owed until U4.

TESTS (fake transport only; no socket to the internet in verify):
- R75: a scheduled run sends zero signed-in requests; a sixth signed-in request in one run is refused; two
  signed-in requests are ≥ 10 s apart under an injected clock.
- R80: a 401 on a keyed source and a login-page 403 on a signed-in one each give EXPIRED, no backoff, public
  fallback; R79: two BLOCKED runs change nothing, the third disables the source.
- R77: the exemption is ignored without the credential, outside `paths`, or with no reviewer/date.
- R81: a STATE-precision event is absent from "within 100 km" and present with `includeUnknown.location`.
- R87: tags from a Devfolio and a CTFtime fixture reach `event_tags` and the tags filter finds them.
- R88: `top_trust_rank` is right after link, merge and unmerge; the new perf scenario meets its budget.
- `$` anchor: `/api/v1/events/{id}/$` refuses `/api/v1/events/1/extra`.

ACCEPTANCE: `pnpm verify` green and < 120 s (R89) · the new perf scenario within budget (numbers in the report)
· gazetteer size and row counts reported · every regenerated golden listed with its reason · the owed live runs
either run with logs pasted or listed as owed · `pnpm audit:deps` clean · no new dependency · files < 400 lines.

OUT OF SCOPE: UI/shell work (pre-M2a) · curating campus coordinates (WP-29, R82) · WP-30's source table and
health badge · notifications for R79/R80 (WP-23) · anything in M2.

Finish per CLAUDE.md (verify, PROGRESS.md ≤ 10 lines and < 150 total, docs/handoff/pre-M2b.md, commit
"pre-M2b: ingestion and search corrections", print the report).
