# ADR-0016: Source verdicts, cadence, politeness, PII stripping and attribution

- **Status:** Accepted (spec v1.1, 2026-09-20)
- **Date:** 2026-09-20
- **Source:** ARCHITECTURE.md §1 (D-26…D-32), §7.1–§7.4; evidence in docs/research/source-feasibility.md (WP-02)

## Context
WP-02 read each source's Terms and robots.txt. Devpost's Terms explicitly prohibit scraping; Unstop's
Terms could not be read (JS-only page); CLIST requires an API key; CTFtime asks for a 10 s crawl delay
and no model training; Devfolio's Terms are silent and its robots.txt allows everything. Source payloads
contain personal data (participants, judges, organiser phone numbers). None of 117 Indian campus sites
publish schema.org Event JSON-LD.

## Decision
- **Verdicts:** CTFtime APPROVED_WITH_LIMITS (API only) · Devfolio APPROVED_WITH_LIMITS (public
  server-rendered pages only, never `api.devfolio.co`) · CLIST APPROVED_WITH_LIMITS once an account/key
  exists · Unstop MANUAL_IMPORT_ONLY until a human reads its Terms · Devpost MANUAL_IMPORT_ONLY ·
  campus/fest sites PENDING_REVIEW, approved per site.
- **Cadence:** 15-minute refresh cycle; per-source minimum interval (Devfolio 15 min, Unstop 15 min if
  approved, CTFtime 30 min, CLIST 30 min, campus sites 12 h); manual refresh floor (5 / 10 min, 1 h).
- **Politeness:** per-host delay = max(3 s, source setting, robots Crawl-delay); robots cached per host;
  requests limited to `allowed_paths_json`; capped requests per run; TLS validation never disabled;
  403/WAF → BLOCKED, never retried with another User-Agent; no scraping before the setup wizard has
  recorded `scraper.contactEmail`.
- **PII:** `EventCandidate` has no people fields; adapters drop participants, judges and contact data;
  e-mails and phone numbers in descriptions are redacted at ingest.
- **URL import:** allowed for approved sources' domains (via that adapter) and unlisted domains
  (generic one-page extractor, robots-checked); refused for MANUAL_IMPORT_ONLY/BLOCKED domains, which
  open the manual form with the link attached.
- **Scope:** only tech event types in the MVP (case/quiz/marketing/cultural hidden by policy).
- **Attribution & reuse:** sources shown on every event; CTFtime and CLIST credited in About; no
  republishing outside the app; no model training on source data.
- **Trust rank:** organiser's own site > Devfolio/Unstop > CTFtime > CLIST.

## Consequences
- Roadmap: WP-12 becomes the Devfolio adapter; WP-13 is Unstop only if its Terms allow; Devpost events
  are entered manually. Unstop — the most valuable Indian source — waits on a 5-minute human task (U3).
- The feed starts with fewer sources but every automated access is defensible.
- Campus sites are low-yield and high-maintenance; WP-29 is reduced and may move after the pilot.

## Alternatives considered
- Scraping Devpost despite its Terms: rejected (violates D-10 and the product principles).
- Headless-browser rendering of Unstop before its Terms are read: rejected.
- A strict 15-minute cadence for every source: unnecessary load on slow or human-moderated sources.
