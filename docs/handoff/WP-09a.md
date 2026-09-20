# WP-09a — PoliteHttpClient, the compliance gate, source seeds, scrape runs, jobs, snapshots

**Status: DONE** · 21 Sep 2026 · spec v1.1.9, rulings **R58–R61** · `pnpm verify` green,
**2371 tests** (2132 at the end of WP-08b).

No adapter ships. The registry is empty on purpose, exactly as WP-04c shipped a job runner with no
jobs: WP-09b registers CTFtime and its `scrape:ctftime` job appears with no wiring to add.

## 1. The acceptance criteria, one by one

| Criterion | Where it is proved |
|---|---|
| Eight §19 failure modes, offline | `scraping/http/client.test.ts` (transport level) + `scraping/run.test.ts` (the `scrape_runs` row **and** the §7.7 message) |
| No test opens an internet socket | `scraping/offline-suite.test.ts` — see §2 |
| `pnpm audit:deps` | No known vulnerabilities (undici 8.10.2, robots-parser 3.0.1) |
| Files < 400 lines | ESLint `max-lines`, unchanged since pre-M1 |
| `src/domain/**` boundary clean | ESLint `no-restricted-imports`; `domain/scraping/` imports nothing but contracts |
| `pnpm verify` | format · lint · typecheck · **2371 tests**, ~75 s |

Also run: `pnpm --filter @compintel/backend smoke:bundle` → **PASSED** (see §6, deviation 1).

## 2. How "no internet socket" is proved

Not by watching the suite, which would only prove it for the tests that exist today.

`undiciFetcher` is the only code that can open a socket, and it sits behind an injected `Fetcher`.
Three greps in `offline-suite.test.ts` keep that true as the codebase grows:

1. `undiciFetcher` is referenced from **exactly one file**, `main.ts` (comments are stripped first, so
   prose that names it does not count).
2. Nothing imports `undici` outside `scraping/http/undici-fetcher.ts`.
3. No test file constructs a transport of its own.

The fakes answer for `example.test` — a reserved name that resolves nowhere — and the two `node:http`
suites bind 127.0.0.1. The same file greps `src/**` for `rejectUnauthorized`,
`NODE_TLS_REJECT_UNAUTHORIZED`, `checkServerIdentity` and `insecureHTTPParser`: there is no option to
disable TLS validation, and now no way to add one quietly.

## 3. What shipped

| Area | Files |
|---|---|
| Contracts | `sources.ts` (the six enums, `SourceSummary`/`SourceStatus`/`ScrapeRunSummary`/`SourceRefreshResult`, `sourceStatusMessage` = §7.7 as code); `errors.ts` + four `SOURCE_` codes |
| Schema | `db/schema/sources.ts`; migration **0005** (five tables), **0006** (five seed rows) |
| Pure domain | `domain/scraping/gate.ts` (`assessRequest`, `effectiveDelayMs`), `domain/scraping/paths.ts` (the `allowed_paths_json` grammar) |
| HTTP | `scraping/http/` — `types` · `classify` · `read` · `queue` · `robots` · `cache` · `polite-client` · `client` · `undici-fetcher` |
| Ingestion | `scraping/` — `run` (orchestrator) · `items` · `errors` · `source-row` · `detail-refresh` · `snapshots` · `jobs` |
| Adapters | `sources/types.ts` (the §7.1 contract), `sources/registry.ts` (**empty**) |
| Module | `modules/sources/` — `repository` · `records` · `service` · `mappers` · `errors` |
| Routes | `routes/sources.ts` (2 reads + 2 admin writes), wired in `app.ts` and `main.ts` |

## 4. The three decisions worth reviewing

**`allowed_paths_json` entries are host-qualified.** §7.2 writes CTFtime's as bare paths because the
host is obvious in prose; in the database it has to be said, or `/api/v1/events/` authorizes that path
on *any* host. The grammar is `[!]host[/prefix]`, `*.host` for sub-domains only, `{...}` for one path
segment, and a leading `!` denies. Devfolio's row is
`["devfolio.co/hackathons", "*.devfolio.co", "!api.devfolio.co"]` — the denial is what keeps the
wildcard off the private API, and it has its own test.

**A 304 listing must be reported, not inferred.** "Complete walk, zero items" and "the listing has not
changed" look identical and mean opposite things: the first is evidence every record has gone, the
second that none has. `ListingResult.notModified` says which, and the orchestrator then counts every
listed record as `items_unchanged` and leaves §7.6's clock alone. Without it, three 304s in a row
would have marked a healthy source's whole catalogue MISSING.

**robots.txt is outside `max_requests_per_run`.** That cap is the adapter's budget and `requests_made`
is what an administrator reads next to it; counting a once-per-host-per-day precondition in it would
make the two incomparable and make behaviour depend on cache state. The robots count is in the run's
log line instead.

## 5. Minor decisions

1. **`SOURCE_NOT_APPROVED` → `SOURCE_BLOCKED_BY_POLICY`.** The placeholder from WP-08a was renamed to
   §7.7's own name for the row it maps to; nothing consumed it.
2. **The manual floor is measured from the last run of any kind**, not the last manual one. The floor
   protects the source's server, and a scheduled run a minute ago cost it exactly as much.
3. **A source with no adapter is a 409, not a failed run.** Recording a failure for "we have not
   written this adapter yet" would start a 12-hour backoff ladder over our own roadmap.
4. **`detail-refresh` writes no `scrape_runs` row and touches no `source_state`.** Those describe
   listing runs; §7.6 counts them and Source status reads them. Its health is its `job_state` row.
5. **A retry waits `max(exponential step, effective host delay)`.** A retry is another request, so the
   crawl-delay applies; with the 3-second floor the first step is 3 s rather than 2 s.
6. **A response over the 5 MB cap is `UNKNOWN`, not `NETWORK`.** Nothing went wrong on the wire and a
   retry would pull the same oversized body again, so it is answered once.
7. **403/401/451 are `BLOCKED`, never retried and never with another User-Agent** (R60). The source
   still backs off and is tried again at the next cadence — R60 forbids *varying* the retry, not ever
   speaking to a host that once returned a WAF page. Say if that reading is wrong.
8. **Reads (`GET /sources`, `/sources/status`) need a session but not `source.manage`.** "Where did
   this event come from and how fresh is it" is a professor's question; every write is admin-only.
9. **A `scrape_runs` row opens as `FAILED`** and is corrected on close, so a process killed mid-run
   leaves a row that does not claim a success it never reported.
10. **`SourcesRepository.update` names its five writable columns one at a time.** A test that called
    the service with a smuggled `complianceStatus` showed that spreading the patch wrote it; the zod
    schema stops it at the route, but the repository is now the second lock.

## 6. Deviations from the prompt

1. **`smoke:bundle` was already broken and is now fixed.** It fails on `main` at `ad47aec` too — the
   institutions seed resolved its path from `import.meta.dirname`, which is five directories from the
   repository root in a checkout and one from the bundle, so the packaged backend died at startup with
   `ENOENT … C:\Users\Calamity\resources\institutions\seed.json`. The seed now resolves through
   `platform/resources.ts` like the gazetteer and `bundle.ts` copies `resources/institutions/`. Out of
   WP-09a's scope, but this work package adds to the same bundle and a backend that cannot start is
   not something to leave for WP-31.
2. **`robots-parser` is imported statically, not through `createRequire`.** Its declaration file opens
   with `declare module 'robots-parser';`, which makes TypeScript type the default import as the
   module namespace; the first fix was `createRequire`, which esbuild cannot follow, so the bundle
   would have failed on the first robots fetch. It is now a static import plus a cast.
3. **`snapshots` joined `DATA_SUBDIRS`** so the directory is created and write-probed at startup like
   the other four.
4. **A southern-hemisphere DST bug in `platform/time.ts` is fixed.** WP-08a's fast-check property drew
   a fresh seed on one of the final runs and failed: `toUtcInstant` resolved 02:00 on 5 October 2025 in
   `Australia/Sydney` — a time the spring-forward skips — to **01:00, an hour early**. A
   spring-forward *increases* the offset, so the corrected candidate lands *after* the guess in the
   southern hemisphere and *before* it in the northern one, and the gap bisection was given its bounds
   in the northern order only. One `Math.min`/`Math.max`, plus a regression test pinning the exact
   counterexample in `platform/time.test.ts`. Pre-M1 code and outside this work package, but an
   Australian hackathon deadline an hour early is the one direction that loses entries, and the
   property test was going to fail for whoever drew that seed next.

## 7. New dependencies

- **undici@8.10.2** — the HTTP transport §4.8 names. Version 8 rather than 7 because fastify already
  pulls 8 transitively; one copy instead of two. `EnvHttpProxyAgent` gives the proxy support, and the
  redirect interceptor caps redirects at three.
- **robots-parser@3.0.1** — the robots.txt parser §4.8 names. Ships its own types, no dependencies.

## 8. Known issues / tech debt

- **`EnvHttpProxyAgent` does not read WinINET.** The Windows "Internet Options" proxy is invisible to
  Node; §7.7's "the backend uses the Windows system proxy" is true only if `HTTPS_PROXY`/`NO_PROXY`
  are in the backend process's environment. The shell should pass them (WP-31), and the caveat is
  written into `undici-fetcher.ts`.
- **`detail()` may rely only on `externalKey` and `url`.** A record awaiting a detail fetch is
  reconstructed as a `ListingItem` whose `payload` is the stored candidate, not the original listing
  payload. Documented in `sources/types.ts`; WP-09b should confirm it is enough for CTFtime.
- **A detail fetch that fails validation increments `items_invalid` and leaves the listing row.**
  Defensible, but it means an adapter whose detail step is broken shows a non-zero `items_invalid` on
  every run with no other signal.
- **`markMissing` is a correlated subquery per record.** Right for a few thousand records per source;
  it is not the query for a source with a hundred thousand.
- **No `GONE`.** The enum has it; nothing sets it. A 404 on a detail fetch should, and that needs an
  adapter to produce one (WP-09b).

## 9. Questions for the architect

1. **Is minor decision 7 the right reading of R60?** A 403 backs the source off and is retried at the
   next cadence with the same User-Agent. The alternative reading — "BLOCKED is terminal, set
   `compliance_status = BLOCKED` and stop for good" — is defensible and would make the ruling's title
   literal, but it turns a transient Cloudflare page into a permanent verdict a human must undo.
2. **Should `scrape_runs` gain a `kind` column** so `detail-refresh` can record its work (minor
   decision 4)? Today it is invisible outside the log and `job_state`, which is thin for WP-30's
   health screen.
3. **CTFtime's cadence is 30 minutes** (D-27/§7.2), but `source-feasibility.md` recommends 60 —
   "CTF events are announced weeks ahead". The seed follows D-27. Confirm, or the seed changes.
4. **`trust_rank` for Devpost** is 60, matching the other registration platforms; the prompt's list
   does not name it. Confirm.
5. **Who owns re-enabling a paused source?** `PARSE`/`SCHEMA_CHANGED` sets `is_enabled = false` and an
   admin re-enables it through `PATCH /admin/sources/:key`. There is no notification yet — §7.7 says
   "Admins have been notified", which is WP-23's.

## 10. Files the architect should review (most important first)

1. `apps/backend/src/domain/scraping/gate.ts` + `paths.ts` — the whole compliance decision, pure.
2. `apps/backend/migrations/0006_seed_sources.sql` — the five verdicts, as data.
3. `apps/backend/src/scraping/run.ts` — which outcome a run gets, and what each one does to state.
4. `apps/backend/src/scraping/http/polite-client.ts` — the gate/robots/queue/retry pipeline.
5. `apps/backend/src/scraping/offline-suite.test.ts` — how the two "never" rules are kept true.

## 11. Suggested next step

**WP-09b** — the CTFtime adapter. Everything it needs exists: `AdapterRegistry.register()` makes its
job appear, `sources.key = 'ctftime'` is seeded and enabled with the right paths and a 10-second
delay, and `test/fixtures/ctftime/` already holds real payloads from WP-02.
