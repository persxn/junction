WP-09a — PoliteHttpClient, the compliance gate, source seeds (D-26), scrape runs/state, scrape jobs, snapshots

Fresh session. Read ONLY: docs/PROGRESS.md · docs/handoff/WP-04c.md · docs/handoff/WP-08a.md ·
docs/handoff/WP-08b.md · docs/adr/ADR-0007-scraping-compliance-gate.md ·
docs/adr/ADR-0016-source-verdicts-cadence-politeness.md · docs/ARCHITECTURE.md §4.8, §4.9, §6.2 ("Sources &
ingestion" table), **§7 preamble, §7.1, §7.2 (every bullet and the whole source table), §7.6, §7.7, §7.8**, §21
(A8, A9, A10, R12, R20–R23, R31, R44) · docs/DECISIONS.md (D-23, D-26…D-29, D-32) ·
**docs/research/source-feasibility.md** (its verdicts bind — that file, not memory) · docs/research/robots/*.txt
· packages/contracts/src/{errors,jobs}.ts · apps/backend/src/{jobs,platform,testing,db,modules/settings}/**.

STEP 0 — Record the architect's rulings (docs only, first commit "docs: rulings v1.1.9"):
a) Version line → "**Version:** 1.1.9"; changelog row
   "| 1.1.9 | 20 Sep 2026 | Rulings R58–R61: polite client, compliance gate, source backoff, snapshots (see §21). |"
   Use the next free version and R numbers if 1.1.9 / R58 are taken.
b) Append to the §21 table:
| R58 Conditional-GET validators get a table | `http_cache` (url PK, etag?, last_modified?, fetched_at, content_hash) joins §6.2 beside `source_records`: validators belong to a URL, not to a record, and detail URLs outnumber records. A 304 costs no parse and no write beyond `last_seen_at`. | §6.2, §7.2 |
| R59 Source backoff is not job backoff | The 15 → 30 → 60 min … 12 h ladder is WP-04c's helper, imported not copied, but the state lives in `source_state` (`consecutive_failures`, `backoff_until`): a source backoff is a politeness obligation shown in Source status and must survive a job being re-registered or renamed. `job_state` keeps only the runner's own health. | §4.9, §7.2, R21 |
| R60 Blocked stays blocked | A 403/WAF response is recorded `BLOCKED` and never retried — not with another User-Agent, not with TLS validation relaxed; a MANUAL_IMPORT_ONLY, PENDING_REVIEW or BLOCKED source makes **zero** requests. Both are proved on a fake transport, not by a live call, and no test in `pnpm verify` opens an internet socket. | §7.2, D-28 |
| R61 The reachability probe is the client's | R23's interface-table check stays the cheap first answer; the confirming probe lives in the PoliteHttpClient, honours the target host's effective delay and is cached ≤ 1 per 5 min. Offline → `SKIPPED_OFFLINE`, never a failure. | §4.9, R23, D-23 |
c) PROGRESS.md "Current": next WP is WP-09b; roadmap 18 done, 30 remaining.

Every rule below is enforced in code and proved by a test — a comment is not enforcement.

BUILD:
1. contracts — `sources.ts`: `ComplianceStatus`, `AdapterKind`, `ScrapeTrigger`, `ScrapeOutcome`,
   `ScrapeErrorKind`, `Presence`, `MatchMethod` (the literal sets from §6.2) plus `SourceSummary`,
   `SourceStatus` (last run/success, freshness, next attempt, error kind + message) and `SourceRefreshResult`.
   `SOURCE_` ErrorCodes (R12): `SOURCE_NOT_FOUND`, `SOURCE_BLOCKED_BY_POLICY`, `SOURCE_ROBOTS_DISALLOWED`,
   `SOURCE_REFRESH_TOO_SOON`, `SOURCE_SETUP_INCOMPLETE` (`SOURCE_UNREACHABLE` exists, R31).
2. Migration (`db:generate`, **never `drizzle-kit push`**; `pnpm typecheck` first — PROGRESS.md's drizzle/dist
   caveat): `sources`, `source_state`, `scrape_runs`, `source_records` exactly as §6.2 lists them, CHECKs built
   from the contracts enums, FKs, UQ(source_id, external_key) and the indexes §6.2 names, plus `http_cache`
   (R58). WP-08a's `source_record_id` columns stay unconstrained TEXT (R49) — do not rebuild those tables.
3. `src/scraping/http/` — **PoliteHttpClient** over undici (add `undici` + `robots-parser`, pinned). Its
   transport comes through an injected `Fetcher` seam so tests run offline, and it is the only network access an
   adapter gets (§7.1).
   - **Robots** cached 24 h **per host** (scheme+host+port — Devfolio hackathons live on their own subdomains,
     so `devfolio.co` and `<slug>.devfolio.co` are two entries): disallowed path → `ROBOTS_DISALLOWED`, **no
     request made**; robots 404/5xx → no rules; a robots timeout → that host is disallowed for the run.
     **Delay** = `max(3000, sources.min_delay_ms, robots Crawl-delay)` (A9/D-28), enforced by a per-host queue
     with **max 1 in-flight request per host**, under the `max_requests_per_run` cap.
   - GET/HEAD and https only; conditional GET from `http_cache`; connect timeout 10 s, total 30 s; 5 MB cap
     (aborted, never buffered past it); proxy via undici `EnvHttpProxyAgent` (WinINET is not read — say so).
   - **User-Agent** `CompIntel/<version> (+mailto:<settings.scraper.contactEmail>)`, read at request time; with
     setup incomplete or the e-mail unset the client **makes no request at all** (A10/R44).
   - **Retries**: at most 2, exponential + jitter, only for NETWORK/DNS/TIMEOUT/5xx; 429/503 honour
     `Retry-After` (delta-seconds or HTTP-date), past the run budget → `RATE_LIMITED`; 403/WAF and TLS per R60.
   - `isOnline()` and the cached reachability probe per R61.
4. `src/domain/scraping/gate.ts` — **pure** (the ESLint domain boundary applies): given `{complianceStatus,
   isEnabled, allowedPaths, robots, url, method, setupComplete, requestsMade, cap}` → ALLOW or a refusal with a
   reason. A source runs only if `compliance_status ∈ {APPROVED, APPROVED_WITH_LIMITS}` and the URL matches
   `allowed_paths_json`. The client and the orchestrator both call this one function.
5. Seed five sources in a data migration with fixed UUID literals, from D-26 + `source-feasibility.md`
   (cadence/manual floor from D-27): **ctftime** (CTFTIME_API, APPROVED_WITH_LIMITS, enabled, 30/10,
   `min_delay_ms` 10000, paths `/api/v1/events/` and `/api/v1/events/{id}/` only, `max_requests_per_run` 6,
   attribution text, notes quoting the API terms and `ai-train=no`) · **clist** (CLIST_API,
   APPROVED_WITH_LIMITS, **disabled — U4, no key**, 30/10, delay 6000) · **devfolio** (DEVFOLIO,
   APPROVED_WITH_LIMITS, **disabled until WP-12**, 15/5, delay 3000, paths `devfolio.co/hackathons` +
   `<slug>.devfolio.co`, never `api.devfolio.co`) · **unstop** and **devpost** (MANUAL_IMPORT_ONLY, disabled,
   notes U3 / the ToS quote). `trust_rank`, higher = more trusted (§7.5): organizer or college site 100 ·
   devfolio and unstop 60 · ctftime 40 · clist 20. Later adapter WPs upsert their row by key, never clobbering
   `version`.
6. `src/sources/registry.ts` (the adapter registry — **empty here**; WP-09b registers the first one and its job
   then appears on its own) and `src/scraping/run.ts` (the orchestrator): gate → offline and backoff checks →
   open a `scrape_runs` row → `adapter.listing()` → **each item in its own transaction** (upsert
   `source_records`, validate `payload_json` as an `EventCandidate`, hash, presence LISTED) → `detail()` only
   when an item's hash changed and within the detail cap, the rest left to `detail-refresh` → close the run with
   `outcome`, `listing_complete` (adapter-reported, A8), `requests_made`, `items_*`, `duration_ms`. **One bad
   item never fails a run**: it lands in `items_invalid` with warnings and the run is SUCCESS, or PARTIAL when a
   page or request failed. §7.6: a record unseen in **3 consecutive complete** runs → `presence = MISSING` +
   `missing_since`; PARTIAL runs never count; nothing is ever auto-cancelled. Backoff per R59;
   `PARSE`/`SCHEMA_CHANGED` pauses the source until an admin re-enables it (§7.7). Matching into `events` is
   WP-10's: this WP leaves `source_records.event_id` null.
7. Jobs — **R22, and the first WP to register any**: `scrape:<source>` per enabled approved source (SCRAPE,
   `next_due_at` from `cadence_minutes`, on D-27's 15-minute cycle) and `detail-refresh` (SCRAPE, changed items
   only). A manual `trigger()` respects `manual_min_interval_minutes`.
8. Snapshots (§7.8): `src/scraping/snapshots.ts` gzips raw responses to
   `<dataDir>/snapshots/<source>/<yyyy-MM>/<recordId>-<iso>.json.gz`, referenced by
   `source_records.raw_snapshot_ref`, pruned at the end of every run to **14 days, max 3 per record, 300 MB
   total**, oldest first. Export the path in one `BACKUP_EXCLUDED_DIRS` constant with a test; WP-28 consumes it.
9. Routes: `GET /api/v1/sources` and **`GET /api/v1/sources/status`** (the list WP-16b renders) ·
   `PATCH /api/v1/admin/sources/:key` (enable/disable, cadence, delay — **never `compliance_status`**) ·
   `POST /api/v1/admin/sources/:key/refresh` (inside the floor → `SOURCE_REFRESH_TOO_SOON`). Admin only per
   §10.2 via `assertCan`, every write audited, `version` → 409. No UI.

TESTS (all in `pnpm verify`, against the fake transport or a local `node:http` server):
- The eight §19 failure modes, each asserting the `scrape_runs` row (outcome, `error_kind`) **and** the §7.7
  message: **timeout · 429 with `Retry-After` · 5xx (retried, then FAILED) · robots disallow (transport never
  called) · TLS error · 403 (BLOCKED, one attempt, same UA) · format change (SCHEMA_CHANGED, source paused, no
  partial writes) · offline (SKIPPED_OFFLINE, not a failure)**.
- **Zero-request proofs on the fake transport** (R60): a MANUAL_IMPORT_ONLY source, a disabled source, a URL
  outside `allowed_paths_json`, and **setup incomplete / `contactEmail` unset** (A10/R44).
- Delay maths over (3 s floor, source setting, robots value) including CTFtime's real `Crawl-delay` **parsed
  from `docs/research/robots/ctftime.org.txt`, not hardcoded**; robots cached 24 h per host (two subdomains =
  two fetches, same host twice = one, hour 25 = a refetch); one in-flight request per host; the run cap stops a
  run cleanly; 304 → `items_unchanged`; no `src/**` dispatcher option disables TLS verification.
- Item isolation (one invalid item of five → `items_invalid = 1`, four records written, SUCCESS) · lifecycle (3
  complete runs without a record → MISSING, a PARTIAL in between counts for nothing, never cancelled) · the
  ladder 15/30/60/…/720 min against an injected clock · snapshot retention, its caps and the exclusion constant
  · the seeds match `source-feasibility.md` on statuses, paths, delays and trust ranks.

ACCEPTANCE: `pnpm verify` green · all eight failure modes covered offline · **no test opens an internet socket**
(say how you proved it) · `pnpm audit:deps` reported (undici, robots-parser) · files < 400 lines · the
`src/domain/**` import boundary clean.

OUT OF SCOPE: any real adapter (WP-09b/11/12/13), matching/merging or any write to `events` (WP-10), URL import
(WP-14), Source status UI (WP-16b/WP-30), the Playwright/Edge path, the CLIST key (U4), Unstop (U3).

Finish per CLAUDE.md (verify, PROGRESS.md ≤ 10 lines and < 150 total, docs/handoff/WP-09a.md, commit "WP-09a:
polite HTTP client, compliance gate, source seeds and scrape runs", print the report).
