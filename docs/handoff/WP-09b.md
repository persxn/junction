# WP-09b — CTFtime adapter: listing + detail over the documented API, golden tests

**Status: PARTIAL** · 21 Sep 2026 · spec v1.1.10, rulings **R62–R63** · `pnpm verify` green,
**2445 tests** (2371 at the end of WP-09a).

Everything in BUILD and TESTS is done and runs offline. **The one manual live smoke was not run.**
The dev data directory has no `scraper.contactEmail`: its `settings` table is empty, and the DB is still
at migration 4 of 8. That address goes to ctftime.org in the User-Agent, so I asked the owner which one
to use, and they chose to skip the smoke. **No request has been made to ctftime.org by this work package.**

## 1. Acceptance, one by one

| Criterion | Where / result |
|---|---|
| `pnpm verify` green | format · lint · typecheck · **2445 tests**. One of three full runs timed out on `routes.test.ts › body limit` (20 s, under load); it passes alone and passed on the next full run. Unrelated to this WP. |
| Goldens committed and read by eye | `test/fixtures/ctftime/listing-events.candidates.golden.json` (5 events), `detail-event-3417.candidate.golden.json` |
| Only the two documented paths | `adapters/ctftime/run.test.ts`: every URL of a whole run matches `/api/v1/events/?…` or `/api/v1/events/{digits}/` (plus the client's own robots.txt). Six other paths are refused by the gate with **zero** transport calls. |
| No network in verify | Fake transport only. `offline-suite.test.ts` now allows `undiciFetcher` in `main.ts` **and** `tools/scrape-once.ts`, and a new test keeps scrape-once out of the bundle and every import graph. |
| Live smoke output | **Not run** (see above). |
| Files < 400 lines, domain boundary | ESLint clean. `scraping/run.ts` is at 398. |
| `pnpm audit:deps` | Not needed: no dependency added. |

## 2. What shipped

| Area | Files |
|---|---|
| Rulings | `ARCHITECTURE.md` v1.1.10, §21 R62 + R63, reservation now R64–R66 (commit `docs: rulings v1.1.10`) |
| Contracts | `event-candidate.ts`: `CandidateAlternateClaim` + `alternateClaims` (R63; there was no channel), `eligibility.qualifiedOnly`, warning `DATE_DURATION_MISMATCH` |
| Adapter | `src/adapters/ctftime/` — `schema.ts` (zod, `.loose()`), `paths.ts` (the only two URL builders), `location.ts`, `prizes.ts`, `map.ts` (pure), `adapter.ts` |
| Wiring | `sources/registry.ts` `registerBuiltInAdapters()`, called from `main.ts` once the geocoder exists → `scrape:ctftime` appears |
| Orchestrator | `AdapterFormatError.raw`; `run.ts` keeps a failed body as a snapshot filed under `format-failure` |
| Seed | migration **0007**: attribution → "Event data from CTFtime (ctftime.org)", and a path denial (§4.1) |
| Geocoder | `Geocoder.institutionNamed()` — a public wrapper over the existing matcher, for `organizer_kind` |
| Dev tool | `tools/scrape-once.ts` + `scrape-once-check.ts`, script `scrape:once` |
| Fixtures | `pii-description.json`, `invalid-dates.json` (hand-written, and each says so in its text) |

## 3. The mapping in one table (recorded goldens)

| Event | Mode / place | Prize | Claim | Notes |
|---|---|---|---|---|
| 3417 SCAN Final | OFFLINE, Seoul KR, CITY, `Asia/Seoul` | "2 BTC" text, no total | — | `qualifiedOnly` true (Prequalified) |
| 3435 LUN4R | ONLINE, no place | "$500 / $300 / $200" text | "₹50,000 / ₹30,000 / ₹20,000" | R63 case |
| 3422 FlightPath | ONLINE, no place | — | — | High-school → UG/PG/PhD false @0.9; "USA only" in eligibility text |
| 3374 BCS | ONLINE | text; "ticket valued at USD 400" is **not** a total | — | |
| 3093, 3312 | ONLINE | "TDB"/"TBD" text | — | |

All six give `event_type` CTF (1.0), `edition_year` 2026, `fee {known:false}`, no team size, and DATETIME dates.

## 4. Decisions worth the architect's eye

1. **The path grammar is prefix-only, so the seed had to change.** `ctftime.org/api/v1/events/` also
   allowed `/api/v1/events/3417/anything/`, which made the `{id}/` entry redundant. 0007 adds
   `!ctftime.org/api/v1/events/{id}/{below}`, and a denial always wins. What still gets past the gate:
   `/api/v1/events/<one non-numeric segment>/` and `/api/v1/events/x` (no trailing slash). The adapter
   cannot build either, but the gate would not stop one. Closing that needs an end anchor in
   `domain/scraping/paths.ts`, which is WP-09a's gate, so I didn't change it (Q1).
2. **The timezone: "UTC at lowered precision" was read as applying to the zone, not the instants.**
   CTFtime's `start`/`finish` carry their own offset, so they are exact. The shared library lowers
   *every* date's precision when it assumes UTC, which would have shown "28 Sep (time not stated)" for a
   CTF that states 01:00 UTC. So the adapter passes UTC as the source default, keeps DATETIME, leaves
   `timezone` **absent** and adds `TIMEZONE_ASSUMED`. The venue decides where it can, through a small
   country table in `location.ts` (≈55 names, a zone only for single-zone countries).
3. **An event whose dates contradict each other is invalid.** `map.ts` drops both dates with
   `DATE_RANGE_INVALID`, as §7.3 says. The adapter's `normalize()` then refuses a CTFtime candidate with no
   `startsAt`, and that refusal is what produces the prompt's `items_invalid = 1`.
4. **The listing is read whole before anything is yielded.** That is what makes "no records on
   SCHEMA_CHANGED" true. It also spends the listing requests before the orchestrator's detail step
   starts. The walk narrows by cursor (the next window starts at the page's latest `start`), not by
   bisection. A full page that is out of start order stops the walk as incomplete (A8).
5. **The geocoder is injected into `map.ts` as an interface** (`CtftimeGeo`), so the mapper stays
   I/O-free. The place carries lat/lon and `geoPrecision`, so WP-10's geocoder takes its rung 1 and
   keeps them. `CandidatePlace`'s comment still says "unresolved"; the prompt overrides it for CTFtime.

## 5. Minor decisions

1. `kind` is `CTFTIME_API`. `AdapterKind` has no `API` member.
2. The record URL is `https://ctftime.org/event/{id}/`, built from the id. `ctftime_url` → `registrationUrl` as given.
3. A per-record snapshot is that event's own object, re-serialized. Snapshotting the whole page for every record would store it a hundred times.
4. `detail()` given a non-numeric id makes no request and returns an empty payload, so that item is invalid rather than the whole run failing. It relies only on `externalKey`, which confirms WP-09a's note that this is enough for CTFtime.
5. Prize total: one amount only, in a known currency, and either "total"/"pool" in the text or text of ≤ 40 characters. The prize text is redacted too.
6. R63 claim: at most one per event, holding every description line that has an amount in a prize context. Emitted only when `prizes` is non-empty and the two sets of figures differ.
7. Duration cross-check tolerance is < 1 h, because CTFtime truncates to whole hours (3422 is 2 d 7.5 h and says 2 d 7 h).
8. Co-organizers go into the description as "Co-organized by: …". An online event's non-empty `location` goes into the eligibility text.
9. `organizer_kind` is COMMUNITY @0.7, or the matched institution's kind @0.8.
10. `scrape:once` respects the manual floor. It also runs pending migrations (the dev DB is at 4 and would go to 8, with WP-04b's pre-migration copies) and logs every request's URL, User-Agent and gap.

## 6. Known issues / tech debt

- **A first run spends 5 of its 6 requests on redundant detail fetches.** The listing already returns full objects (`source-feasibility.md` §1.4), but the orchestrator fetches a detail for every changed item. It is harmless, but it costs 50 s of CTFtime's crawl delay per new batch (Q2).
- **A 404 on a detail fetch fails the run** (as a caught `HTTP_4XX` → PARTIAL) instead of marking the record GONE.
- "Korea" is read as KR.
- `scraping/run.ts` is at 398 lines. The next change there needs a split.

## 7. Questions for the architect

1. Should `allowed_paths_json` gain an end anchor (say, a trailing `$`), so `ctftime.org/api/v1/events/{id}/$` means exactly that path?
2. Should CTFtime skip detail fetches for new items, given that the listing already carries every field? This could be `maxDetailsPerRun: 0` in its `config_json`, but then `detail-refresh` would still owe them. It may be better as an adapter flag.
3. Is "a CTFtime event with no usable dates is invalid" (§4.3) the reading you want, rather than storing it undated?
4. Is §4.2's reading of the timezone right? The alternative is to fix WP-08a's library so it never lowers the precision of an instant that carries an offset.

## 8. Files the architect should review

1. `apps/backend/src/adapters/ctftime/map.ts`
2. `apps/backend/src/adapters/ctftime/adapter.ts`
3. `apps/backend/migrations/0007_ctftime_attribution.sql`
4. `apps/backend/src/adapters/ctftime/prizes.ts`
5. `packages/contracts/src/event-candidate.ts` (the `alternateClaims` shape WP-10 will store)

## 9. Suggested next step

Store a contact address as `scraper.contactEmail` in `%LOCALAPPDATA%\CompIntel-dev`, then run
`pnpm --filter @compintel/backend scrape:once -- --source ctftime` **once**. Paste the `scrape_runs` row,
the User-Agent and gap log lines, one snapshot path and two titles into §1 here, and flip this to DONE.
Then start WP-10.
