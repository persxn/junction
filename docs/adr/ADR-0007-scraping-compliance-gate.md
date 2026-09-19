# ADR-0007: Scraping: API-first adapters behind a compliance gate; headless Edge only as last resort

- **Status:** Accepted (spec v1.1, 2026-09-20) — amended
- **Date:** 2026-09-20
- **Source:** ARCHITECTURE.md §1 (D-10, D-16, D-23), §4.8, §7.1, §7.2, §7.7, §7.8

## Context
Events come from Devfolio, Unstop, Devpost, CTFtime and CLIST, plus manual entry, URL import and later
configurable college sites. ToS and robots.txt must be checked before any scraper runs, with no bypassing (D-10) and ₹0 budget (D-16).

## Decision
- Adapter contract: `listing()` / optional `detail()` / pure `normalize()` → zod-validated
  `EventCandidate`. Adapters never touch the DB. Their only network access is `PoliteHttpClient`, and
  they are tested with recorded fixtures (golden files).
- Priority order: API → JSON → HTML (cheerio, schema.org Event JSON-LD, chrono-node) → `playwright-core`
  driving the **installed Edge** (`channel: 'msedge'`, headless), opt-in per adapter, one browser at a time.
- **Compliance gate in code:** a source runs only when `compliance_status ∈ {APPROVED,
  APPROVED_WITH_LIMITS}`. robots.txt is cached 24 h, and a disallowed path yields `ROBOTS_DISALLOWED` with no request.
  Per-host minimum delay 3 s, max requests per run, 1 concurrent request per host. Honour 429/503 and Retry-After.
  Backoff 15 → 30 → 60 min … 12 h. Identifying UA `CompIntel/<version> (+<contact email>)`.
- **Never:** log in, solve or bypass CAPTCHAs or anti-bot systems, rotate IPs or UAs, use credentials, or ignore a ToS prohibition.
- Conditional GETs. Detail fetches only when a listing hash changes. Raw snapshots are gzipped and kept 14 days (300 MB cap).
- The failure taxonomy maps to user messages. Offline yields `SKIPPED_OFFLINE`, not a failure. The system proxy is used.

## Consequences
- A handful of requests per source per 15-minute run.
- HTML adapters break when sites change, which is handled by fixture tests, health monitoring and a pause on `SCHEMA_CHANGED`.
- Browser runs cost an extra 250–400 MB, transiently.

## Alternatives considered
- Python Scrapy: a second runtime. Crawlee: heavier than needed.

## Amendments (v1.1)
- Source verdicts, cadence, delay rule, PII stripping, URL-import restrictions and attribution are recorded in **ADR-0016**.
- Schema.org JSON-LD is a URL-import fallback, not a primary strategy (0 of 117 Indian campus sites publish it); RSS/Atom feeds and per-site selectors are used for campus sites.
- TLS validation is never disabled; 403/WAF → BLOCKED, never retried with another User-Agent.
