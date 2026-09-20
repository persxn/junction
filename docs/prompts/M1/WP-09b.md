WP-09b — CTFtime adapter: listing + detail over the documented API, golden tests, one manual live smoke run

Fresh session. Read ONLY: docs/PROGRESS.md · docs/handoff/WP-09a.md · docs/handoff/WP-08a.md ·
docs/handoff/WP-08b.md · docs/ARCHITECTURE.md §4.8, **§7.1, §7.2 (the CTFtime row, the "Never" bullet and the
attribution bullet), §7.3, §7.6, §7.8**, §21 (A8, A9, A10, A11, R50, R51, R52) · docs/DECISIONS.md (D-26, D-27,
D-29, D-32) · **docs/research/source-feasibility.md §1 (CTFtime)** · **docs/research/robots/ctftime.org.txt** ·
docs/research/fixtures/ctftime/*.json · apps/backend/src/{adapters,sources,scraping,domain,jobs,testing}/** ·
packages/contracts/src/{events,event-candidate}.ts.

CTFtime is a documented public API with no key. **`/api/v1/events/` and `/api/v1/events/{id}/` are the only
paths this WP may ever request** — never an HTML page, never `/export/`, never a login, never a second
User-Agent. Everything except the single manual smoke run at the end is offline, against recorded fixtures.

STEP 0 — Record the architect's rulings (docs only, first commit "docs: rulings v1.1.10"):
a) Version line → "**Version:** 1.1.10"; changelog row
   "| 1.1.10 | 20 Sep 2026 | Rulings R62–R63: pinned fixtures, second claims instead of conversions (see §21). |"
   Use the next free version and R numbers if 1.1.10 / R62 are taken.
b) Append to the §21 table:
| R62 Recorded payloads are pinned | The WP-02 captures under `docs/research/fixtures/**` are the provenance copy; the adapter's test tree holds byte-identical copies and a test fails if they drift. A golden is never refreshed to make a failing test pass: `UPDATE_GOLDEN=1` is a deliberate act, and the report says what changed and why. | §7.1, §4.15 |
| R63 A second claim, never a conversion | When one source states a field twice and differently — CTFtime's structured `prizes` against a figure in the free-text description — the **structured value is the candidate's value** and the other is carried as an `alternateClaims` entry that WP-10 stores as an unselected `event_field_claims` row. Currencies are never converted, figures never combined, and nothing is dropped silently. | §7.3, §7.5 |
c) PROGRESS.md "Current": next WP is WP-10; roadmap 19 done, 29 remaining.

BUILD:
1. Fixtures: copy `docs/research/fixtures/ctftime/{listing-events,detail-event-3417}.json` verbatim into
   `apps/backend/test/fixtures/ctftime/` with the byte-identity test from R62, plus two hand-written cases —
   `pii-description.json` (a description carrying a real-looking phone number and e-mail; the recorded payloads
   already say `[phone redacted]`, so they cannot prove the redaction path) and `invalid-dates.json` (finish
   before start).
2. `src/adapters/ctftime/adapter.ts` — the `SourceAdapter` (§7.1): key `ctftime`, kind `API`,
   `needsBrowser: false`, `defaultCadenceMinutes: 30` (D-27).
   - `listing(ctx)` walks `/api/v1/events/?limit=100&start=<now>&finish=<now + 120 days>` through `ctx.http`
     only (`limit` is capped at 100 server-side), narrowing the window if a page comes back full. The window and
     the seeded `max_requests_per_run` 6 are chosen so a full walk **fits inside the caps**, and the adapter
     reports `listing_complete` only when it truly finished the walk (A8). It never follows a URL found inside a
     payload.
   - `detail(ctx, item)` fetches `/api/v1/events/{id}/` and nothing else; WP-09a decides when it is called (hash
     changed, within the detail cap). The path is built by a helper from the numeric id — never by string
     concatenation from source text — and a non-numeric id is an invalid item.
   - A response that is not the documented JSON shape (HTML, or a zod failure on the required keys) →
     `SCHEMA_CHANGED`: the run FAILS, the source backs off and pauses, **no `source_records` are written**, and
     the raw body is kept as a snapshot (§7.8) so the fixture can be regenerated.
3. `src/adapters/ctftime/map.ts` — **pure** (no http, no DB, clock injected per R52): fixture → `EventCandidate`
   by an explicit allowlist of fields (R50 means an unlisted key would fail validation anyway). The mapping is
   `source-feasibility.md` §1.5:
   - `title` · `organizers[0].name` → `organizer_name`, further organizers as text, never as people ·
     `organizer_kind` COMMUNITY unless WP-08b matches an institution · **`event_type = CTF` always** (§7.3) ·
     `edition_year` from the start year (A11).
   - `start`/`finish` → `starts_at`/`ends_at` (ISO with offset, the best dates of any source, precision EXACT);
     cross-check `duration {days, hours}` and on a mismatch keep the timestamps with a parse warning; `finish`
     before `start` → both dropped with a warning, never guessed. `timezone` is absent from the API: venue
     location → else UTC at lowered precision (§7.3).
   - `onsite: true` → OFFLINE, `false` → ONLINE (CTFtime has no hybrid); `location` free text → city/country
     through WP-08b's geocoder with `geo_precision` CITY/COUNTRY/UNKNOWN; empty `location` with `onsite: false`
     → ONLINE, no place, no invented country.
   - `url` → `official_url`, `ctftime_url` → `registration_url`; `restrictions` → `eligibility_text` plus the
     obvious flags ("Open" → none, "High-school"/"Prequalified" → a flag with confidence, R51).
   - `fee_known = false` (never 0 — there is no fee field); `team_min`/`team_max` unknown; `participants`,
     `weight`, `logo`, `live_feed`, `is_votable_now`, `public_votable`, `format_id` are dropped.
   - `description` (plain text with `\r\n`) → sanitized Markdown, then WP-08a's redactor: phones and e-mails
     become "[contact details on the source page]" (D-29).
   - **Prizes per R63:** `prizes` → `prize_text`; parse `prize_total_minor`/`prize_currency` only from an
     unambiguous single-currency figure, so "2 BTC" stays text with no numeric total; a different figure in the
     description (the recorded "$500" against "₹50,000") becomes an `alternateClaims` entry. If WP-08a shipped
     no such channel, add `alternateClaims: [{field, value, sourceText, note}]` to `EventCandidate` and say so.
4. Register the adapter in WP-09a's `src/sources/registry.ts` so `scrape:ctftime` starts scheduling. Check the
   seeded row (APPROVED_WITH_LIMITS, delay 10000, cadence 30, the two allowed paths, attribution text) against
   what the run uses and fix the **seed**, not the adapter, if they disagree. Attribution (D-32):
   `sources.attribution_text` = "Event data from CTFtime (ctftime.org)"; nothing is republished and nothing
   feeds model training (`ai-train=no`).
5. `pnpm --filter @compintel/backend scrape:once -- --source <key>`: a dev-only script that performs exactly one
   real run through WP-09a's orchestrator and prints the `scrape_runs` row. It refuses any source that is not
   APPROVED/APPROVED_WITH_LIMITS, and it is wired into no job and no bundle.

TESTS (all offline, in `pnpm verify`):
- **Goldens** via `expectGolden` over the recorded listing (5 events) and detail 3417 — the full
  `EventCandidate` per item, committed under `apps/backend/test/fixtures/ctftime/`; plus R62's byte-identity
  test against `docs/research/fixtures/ctftime/`.
- **Path allowlist**: a fake transport records every URL; a whole run touches only `/api/v1/events/` and
  `/api/v1/events/{id}/`, and an attempt at any other path is refused by the gate with zero requests.
- **Delay**: parse `docs/research/robots/ctftime.org.txt` inside the test and assert the effective delay equals
  its `Crawl-delay` and is ≥ 10 000 ms (A9) — do not hardcode 10.
- **Mode and place**: 3417 (`onsite: true`, "Seoul, Korea") → OFFLINE with a geocoded city; the online fixture
  with an empty location → ONLINE with no place.
- **Prize conflict (R63)**: "$500" vs "₹50,000" → `prize_text` from `prizes`, the description figure as an
  alternate claim, no conversion and no arithmetic; "2 BTC" → text only, `prize_total_minor` null.
- **PII**: no e-mail or phone pattern survives any normalized output, and `pii-description.json` shows the
  placeholder. Every fixture item → `event_type = CTF`, `edition_year` 2026, `fee_known = false`, team unknown.
- **Isolation and breakage**: `invalid-dates.json` → `items_invalid = 1` with the run still SUCCESS; an HTML
  body where JSON is expected → `SCHEMA_CHANGED`, source paused, no records written, snapshot kept.
- End to end on the fake transport: `listing_complete = true`, `items_new` = fixture count on the first run and
  `items_unchanged` on a re-run, one gzipped snapshot per record (§7.8).

MANUAL LIVE SMOKE — **the only network access in this WP; run it once, never in a loop.** With setup completed
on the dev data directory (`%LOCALAPPDATA%\CompIntel-dev`, so `scraper.contactEmail` exists):
`pnpm --filter @compintel/backend scrape:once -- --source ctftime`. Paste into the report: the `scrape_runs`
row (outcome, `listing_complete`, `requests_made`, `items_seen/new/invalid`, `duration_ms`), the log lines
showing the **User-Agent with the contact e-mail** and the **≥ 10 s gap between requests**, the absence of any
403 or 429, one snapshot path with its size, and two normalized titles. If it fails, report the failure as it
happened: retry at most once, and never change the UA, the delay or the paths to make it pass.

ACCEPTANCE: `pnpm verify` green · goldens committed and read by eye · **only the two documented paths are ever
requested** · no network in verify · the live smoke output pasted into the report · files < 400 lines · the
`src/domain/**` import boundary clean · `pnpm audit:deps` if any dependency was added.

OUT OF SCOPE: dedup, merging and writes to `events` (WP-10 — this WP stops at `source_records`), CLIST (WP-11),
Devfolio (WP-12), Unstop (WP-13), URL import (WP-14), any UI, and any change to the client's politeness rules —
if one looks necessary, report it instead of making it.

Finish per CLAUDE.md (verify, PROGRESS.md ≤ 10 lines and < 150 total, docs/handoff/WP-09b.md, commit
"WP-09b: CTFtime adapter with golden tests", print the report).
