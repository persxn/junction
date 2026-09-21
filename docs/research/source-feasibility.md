# WP-02 — Source feasibility & compliance matrix

**Date accessed: 2026-09-20** (all facts, quotes and HTTP results below are from this date) ·
Reviewer: implementation engineer (Claude Code) · Method: `docs/research/wp02-request-log.csv` logs every
request (source, URL, status, bytes, purpose). Cap: **≤ 5 requests per source**, Terms read first, a 3 s delay
between requests, User-Agent `CompIntel-Research/0.1 (one-off source feasibility review; max 5 requests per site)`.
No logins, no CAPTCHA/anti-bot bypassing, no undocumented endpoint was called.

> **This is not legal advice.** Every verdict below is an engineering recommendation for a human to confirm.
> Items marked **⚠ HUMAN REVIEW** must be decided by the product owner or the university before code is written.

## Summary

| Source | API | ToS verdict | robots | Delivery | Recommendation |
|---|---|---|---|---|---|
| **CTFtime** | Public, documented, no key | Permits data export for "data analysis and mobile applications only"; no clones | Allows `/api/`; **Crawl-delay 10**; `ai-train=no` | JSON API | **APPROVED_WITH_LIMITS** |
| **CLIST** | Documented v4 API, **key required** (account) | Free API "for personal, educational and community projects"; attribution; no redistribution | **Disallows `/api/`** for generic bots (docs allowed); homepage 403s our UA | JSON/Atom API | **APPROVED_WITH_LIMITS**, blocked until a human creates the account/key ⚠ |
| **Devfolio** | None public (private `api.devfolio.co`, not called) | **Silent** on scraping/automated access | Allows everything (site + hackathon subdomains) | Server-rendered Next.js with embedded JSON | **APPROVED_WITH_LIMITS** (+ send permission email) |
| **Devpost** | None public | **Explicitly prohibits** scraping/crawling/automated access | Allows `*` (irrelevant: ToS wins) | Not inspected (ToS) | **MANUAL_IMPORT_ONLY** ⚠ (conflicts with WP-12) |
| **Unstop** | `/api/public/*` allowed by robots; undocumented | **Could not be read** — Terms page is JS-only | Allows `/hackathons/`, `/competitions/`, `/api/public/*`; disallows other `/api/*`, `*/register` | Angular SPA | **MANUAL_IMPORT_ONLY** until a human reads the Terms ⚠ |
| **College sites** (117 surveyed) | None | Mostly silent; a few restrict commercial use/publication | 80/117 have robots.txt; **none blocks crawlers wholesale**; 5 set Crawl-delay | Heterogeneous HTML; **zero** Event JSON-LD | **PENDING_REVIEW**, approve per site in WP-29 |

---

## 1. CTFtime

1. **API.** Public and documented at `https://ctftime.org/api/`, **no key**, no registration.
   Endpoints used: `/api/v1/events/?limit={n}&start={ts}&finish={ts}` (listing) and `/api/v1/events/{id}/` (detail).
   No published rate limit; `limit` is capped at 100 per request.
2. **Terms.** CTFtime has no separate ToS document; the API page states the terms of use:
   - *"API for simple data export. Data is in JSON format."*
   - *"This API is provided for data analysis and mobile applications only."*
   - *"You can not use this API to run CTFtime clones — most of the CTFtime data is moderated by humans, please, respect their time."*
   An internal departmental tool that reads events into a private database is "data analysis", not a clone. Our UI is
   not public, so this fits. ⚠ Confirm we never republish CTFtime data publicly.
3. **robots.txt** (`docs/research/robots/ctftime.org.txt`): `User-agent: *` with `Crawl-delay: 10`,
   `Content-signal: search=yes, ai-train=no, use=reference`, and `Disallow: /user/`, `/task/tags/`, `/login/`,
   `/export/`, `/dating/`. **`/api/` and `/event/` are not disallowed.** `ai-train=no` matters: this data must never be
   used to train a model. We only read it into a database, which is "use=reference".
4. **Delivery.** Clean JSON API. The listing returns full event objects, so `detail()` is only needed for changes.
   Event HTML pages (`/event/{id}/`) carry Open Graph tags but **no** schema.org JSON-LD.
5. **Fields → EventCandidate** (from the real payloads in `fixtures/ctftime/`):

   | EventCandidate | CTFtime field | Reliability |
   |---|---|---|
   | title | `title` | High |
   | organizer_name | `organizers[].name` | High |
   | starts_at / ends_at | `start` / `finish` (ISO 8601, **UTC offset included**) | High — the best dates of any source |
   | timezone | *(absent)* — derive from `location` or default UTC | Medium |
   | mode | `onsite` (bool) → OFFLINE/ONLINE | High |
   | city/country | `location` (free text, e.g. "Seoul, Korea"; empty for online) | Low — needs the gazetteer |
   | event_type | always CTF | High |
   | official_url / registration_url | `url` / `ctftime_url` | High |
   | prize_text | `prizes` (free text) | Low — **conflicts with the description** (observed: `prizes` said "$500" while the description said "₹50,000") |
   | description_md | `description` (plain text with `\r\n`) | Medium — contains organiser **phone numbers** → must be redacted or dropped |
   | eligibility_text | `restrictions` ("Open", "High-school", …) | Medium |
   | fee | *(absent)* → unknown, never 0 | — |
   | team_min/max | *(absent)* → unknown | — |
   | quality/weight | `weight`, `participants` | Useful for trust ranking |

6. **schema.org Event JSON-LD:** No.
7. **Recommendation: APPROVED_WITH_LIMITS.**
   - API only, never HTML scraping. Paths: `/api/v1/events/` and `/api/v1/events/{id}/` only.
   - **Per-host delay ≥ 10 s** (robots Crawl-delay overrides our 3 s default), max ~4 requests per run.
   - **Cadence 60 min**, not the 15 min default: CTF events are announced weeks ahead.
   - Never re-publish, never use for model training (`ai-train=no`), attribute CTFtime in the UI.

## 2. CLIST (clist.by)

1. **API.** Documented at `https://clist.by/api/v4/doc/`. **Requires an API key**: *"Accessing the API requires an
   API key, available to authenticated users here."* and *"Non-key access is also available through website sessions."*
   Throttle: *"Standard request limit is 10 per minute."* and *"Should you require a higher limit, please let us know
   to accommodate your needs."* Formats: json, jsonp, yaml, xml, plist; Atom/RSS at `/api/v4/contest/`.
2. **Terms** (`https://clist.by/terms/`, *"Last updated: December 8, 2025"*):
   - *"CLIST may provide a free API intended mainly for personal, educational and community projects."* — our case.
   - Agree to: *"respect any documented or communicated rate limits"*, *"implement reasonable caching to avoid
     repeated requests for the same data within a short time"*, keep credentials secret, and *"clearly attribute
     CLIST as the source of contest data when used in public projects"*.
   - Agree not to: *"resell, repackage or redistribute CLIST's raw data as a competing contest API or commercial data
     feed without a separate agreement with us"*, *"use automated requests in a way that harms the stability or
     performance of the Service"*, and *"not attempt to bypass any technical or access limitations we put in place"*.
3. **robots.txt** (`docs/research/robots/clist.by.txt`): `Disallow: /api/` with `Allow: /api/v*/doc`, plus
   `/calendar/`, `/list/`, `/get/events/`, `/standings/action/`, `/coder/*/ratings/` and more.
   ⚠ **Tension:** robots disallows `/api/` for unauthenticated crawlers while the ToS invites **authenticated** API
   use. Our reading: robots governs crawling; an API key is authorized access under the ToS. A human should confirm,
   and the permission email covers it.
4. **Delivery.** JSON API (also Atom/RSS). **Not called** — no key, and creating an account would mean logging in,
   which this WP forbids. Note from WP-00: `https://clist.by/` returned **403** to our research User-Agent while
   `robots.txt` and `/terms/` returned 200, so HTML scraping is both discouraged and partly blocked. We will not
   attempt to work around that.
5. **Fields → EventCandidate** (from the v4 documentation, **not verified against live data**): `event` (title),
   `host`/`resource` (organizer/platform), `start`, `end`, `duration`, `href` (URL), `n_problems`, `parsed_at`.
   Dates are ISO with a configurable timezone. CLIST is an aggregator, so `trust_rank` should be **low** (§7.5), and
   it is the natural source for recurring rounds (`is_recurring_round`, Contest Calendar, WP-11).
6. **schema.org Event JSON-LD:** Not applicable (API).
7. **Recommendation: APPROVED_WITH_LIMITS — blocked on a human step. ⚠**
   - A human creates a CLIST account and API key (store in `settings`, never logged/exported, §6.2).
   - Rate: ≤ 10 requests/minute, in practice 1–2 per run; **cadence 30–60 min**; conditional GETs and caching.
   - Attribution "Contest data provided by CLIST" in the UI (About + source popover).
   - Never redistribute raw CLIST data; never use website sessions instead of a key.

## 3. Devfolio

1. **API.** No public/documented API. The site's own front end calls `api.devfolio.co`; that host is **undocumented**
   and was **not called**. Not needed — see delivery.
2. **Terms** (`https://devfolio.co/terms-of-use`, *"Effective Date: 29th December, 2020"*, NSB Classic PTE LTD).
   The "User Obligations and Prohibited Use" section lists four prohibitions — unlawful content, unlawful purpose,
   impersonation, and: *"The user shall not wilfully engage in any conduct interfering with, disrupting access to, or
   breaching security of Devfolio and its website, servers, data, etc., including but not limited to distributed
   denial-of-service, upload or distribution of corrupted files, viruses and malware."*
   **There is no clause about scraping, crawling, bots, automated access or data reuse.** ⚠ Silence is not permission:
   polite, low-rate reading of public pages is not prohibited, but a permission email is recommended.
3. **robots.txt**: `User-agent: *` / `Disallow:` (nothing disallowed) — and the same on the hackathon subdomain
   (`recursiveacm.devfolio.co/robots.txt`, verified). Each hackathon has its own subdomain with its own robots.txt,
   so the adapter must fetch robots per host (§7.2 already caches per host).
4. **Delivery.** `https://devfolio.co/hackathons` is **server-rendered Next.js**: the HTML embeds a
   `__NEXT_DATA__` payload with `open_hackathons`, `past_hackathons`, `upcoming_hackathons`, `featured_hackathons`
   as structured JSON. Detail pages (`https://<slug>.devfolio.co/`) embed the full hackathon object the same way.
   **No browser/Playwright is needed** and no private endpoint has to be touched.
5. **Fields → EventCandidate** (from `fixtures/devfolio/`):

   | EventCandidate | Devfolio field | Reliability |
   |---|---|---|
   | title | `name` | High |
   | starts_at / ends_at | `starts_at` / `ends_at` (ISO, UTC offset) | High |
   | timezone | `timezone` (IANA, e.g. `Asia/Calcutta`) | High |
   | registration_opens_at / deadline | `settings.reg_starts_at` / `settings.reg_ends_at` | High |
   | mode | `is_online` + `settings.is_hybrid` | High |
   | city / country / venue | `city`, `country`, `location` (detail only) | High for offline events |
   | team_min / team_max | `team_min`, `team_max` (detail only) | High |
   | fee | `settings.paid` (bool) → known-0 when false | Medium — amount not exposed |
   | prize | `aggregatePrizeValue` + `aggregatePrizeCurrency`, `prizeDetails[]` | Medium (observed 0/USD with a non-empty prize section elsewhere) |
   | description_md | `desc` (Markdown), `tagline`, `faqs[]` | Medium |
   | official_url / registration_url | `settings.site` / `https://<slug>.devfolio.co` | High |
   | organizer_name | Not a field — infer from `location`/site ⚠ | Low |
   | tags/themes | `themes[].theme.name` (often "No Restrictions") | Low |
   | event_type | `type` (`HACKATHON`) | High |
   | **must be dropped** | `participants_details[]` (names, usernames, avatar URLs), `judges[]`, `settings.contact_email` | **PII — never store** |

6. **schema.org Event JSON-LD:** No (Open Graph only).
7. **Recommendation: APPROVED_WITH_LIMITS.**
   - Use only the **server-rendered public pages**: one listing request per run, detail only when a listing item's
     hash changes. Never call `api.devfolio.co`.
   - Delay ≥ 3 s per host, cadence 30–60 min, conditional GETs.
   - **Drop all participant/judge/contact PII at the adapter boundary** (§6.2 data minimisation, D-22).
   - Send the permission email (§ Devfolio in `permission-request-template.md`) because the ToS is silent.

## 4. Devpost

1. **API.** No public API. (Third-party scrapers advertise an internal JSON endpoint; we did not use or verify it.)
2. **Terms** (`https://info.devpost.com/legal/terms-of-service`, *"Last Updated: December 5, 2025"*).
   The prohibited-conduct list includes, verbatim:
   > *"Uses manual or automated software, devices, scripts robots, or other means or processes to access, "scrape,"
   > "crawl" or "spider" the Site, User Content (including User Profiles and Team Pages), or any related data or
   > information;"*
   It also reserves Devpost Content rights: users *"may not modify, transmit, participate in the sale or transfer of,
   or create derivative works based on any Devpost Content"*.
   **This is an explicit prohibition on automated access, and it beats a permissive robots.txt.**
3. **robots.txt** (`docs/research/robots/devpost.com.txt`): `User-agent: *` / `Disallow:` (empty), with a few named
   bots blocked (BLEXBot, Omgilibot, ImagesiftBot, Bytespider). Permissive — **but the ToS governs.**
4. **Delivery.** **Not inspected.** After reading the Terms, no further request was made to Devpost (§7.2: "never …
   ignore a ToS prohibition"). Only the ToS page was fetched (1 request).
5. **Fields → EventCandidate:** not assessed (would require prohibited access).
6. **schema.org Event JSON-LD:** not checked.
7. **Recommendation: MANUAL_IMPORT_ONLY. ⚠**
   - No scraper, no scheduled adapter, `is_enabled = false`, `compliance_status = MANUAL_IMPORT_ONLY`.
   - **This contradicts roadmap WP-12 ("Devpost adapter + geography policy on US in-person events").** The architect
     must re-scope WP-12 or obtain written permission (template provided). Q13's default (manual/URL import + a
     permission email) applies.
   - ⚠ **Open question for the human reviewer:** does a *user-initiated* single-page URL import (WP-14) count as
     "automated software … to access" the site? It is triggered by a person, but performed by our code. Until
     answered, treat Devpost URL import as **not approved**; a professor can copy the details into a manual event.

## 5. Unstop

1. **API.** robots.txt explicitly allows `/api/public/*`, which implies a public-ish JSON API used by the site
   itself, but there is **no published documentation and no published terms for it**. Not called.
2. **Terms — read by the owner on 21 Sep 2026 (U3 DONE, R70).** The page is an Angular SPA, so the text was
   read in a browser, not fetched. Finding: **no clause** on scraping, crawling, robots, spiders, automated access,
   data mining, extraction, harvesting, bots or reproduction, and **no restriction on commercial use of content**.
   The one access clause is a bullet in the account/password section forbidding parts of the Site being cached in
   proxy servers and reached by people who have not registered — about circumventing registration (R70). The
   verbatim wording is the owner's to paste here; WP-13 had no way to fetch it. The Terms carry **no "last
   updated" date**; the verdict is pinned to the footer version string `9.18.2026.17.53`. Reviewer: owner.
   Review-by date: **21 Mar 2027** (R73). IP clause weighed in R72.
3. **robots.txt** (`docs/research/robots/unstop.com.txt`) — the most detailed of any source:
   - `User-agent: *`: **Allow** `/competitions/`, `/hackathons/`, `/internship/`, `/job/`, `/practice/`, `/courses/`,
     `/quiz/`, `/blog/`, `/_next/`, `/static/`, **and `/api/public/*`**.
   - **Disallow** `/api/*` (everything else), `/competitions/*/register`, `/api/get-attachment/*`, `/u/*`, `/p/*`,
     `/pf/*`, `/directory/user/*`, `/certificate-preview/*`, `/mentor/book-mentor/*`.
   - Named AI crawlers (GPTBot, Google-Extended, ChatGPT-User, **anthropic-ai**, Claude-Web, Perplexity, Cohere,
     Amazonbot, Applebot-Extended, Google-CloudVertexBot) are **allowed**; scraper/dataset bots (CCBot, Bytespider,
     Diffbot, Omgilibot, Youbot, DotBot, FriendlyCrawler, img2dataset) are listed separately as blocked.
   - Reading: Unstop tolerates well-behaved automated readers on the listing paths and clearly marks the paths it
     does not want touched. That is **encouraging but not a substitute for the Terms.**
4. **Delivery.** Angular SPA (client-rendered). Listing pages would need either the `/api/public/*` endpoint or a
   headless browser (§4.8 Playwright/Edge path).
5. **Fields → EventCandidate:** not assessed.
6. **schema.org Event JSON-LD:** not checked.
7. **Recommendation: APPROVED_WITH_LIMITS (owner, 21 Sep 2026; R70–R73).** The original recommendation follows for the record:
   Unstop is the **highest-value Indian source** (competitions, hackathons, quizzes with eligibility and fees), so
   this should be the first compliance item closed: a human opens `https://unstop.com/legal/terms-of-use` in a
   browser, checks for scraping/automated-access/data-reuse clauses, and records the result here. If the Terms are
   silent or permissive, this becomes APPROVED_WITH_LIMITS on `/hackathons/` + `/competitions/` + `/api/public/*`,
   delay ≥ 3 s, cadence 30–60 min, never `*/register`, never `/u/`, `/p/`, `/pf/` (user profiles = PII).
   The permission email requests documented API access in parallel.

---

## 6. College / institute sites

### 6.1 Deep review (the WP's 2 IITs + 2 NITs, plus WB/BITS/IIIT-H at the user's request)

| Institute | Policy page | Quoted clause | robots | Delivery | Events content | Verdict |
|---|---|---|---|---|---|---|
| **IIT Madras** (`iitm.ac.in`) | `/terms-use` | *"The use of the Indian Institute of Technology Madras … web portal www.iitm.ac.in is governed by the following terms and conditions."* No scraping clause; only *"IIT Madras uses commercial software programs to monitor network traffic … to help identify Unauthorised attempts to upload or change information"* | **`Crawl-Delay: 10`**; disallows `/node/`, `/search/`, `/user/*`, `/admin/` (Drupal defaults). `/happenings/` allowed | Drupal, server-rendered | `/happenings/events` = academic seminars/talks (date, time, venue, speakers as plain labelled text). No JSON-LD, no `datetime` attributes. Mostly **not competitions** | PENDING_REVIEW — low value |
| **IIT Bombay — ACR office** (`acr.iitbombay.org`) | `/privacy-policy/` (includes T&C) | *"Commercial use or publication of all or any item displayed without prior authorization from IIT Bombay is strictly prohibited."* · *"Documents may be copied for personal use only on the condition that copyright and source indications are also copied…"* | `Disallow:` (empty, Yoast) + sitemap | WordPress | Alumni reunions, not competitions | **⚠ HUMAN REVIEW** — "personal use only" vs. a departmental tool; and Techfest lives on its own domain anyway |
| **NIT Trichy** (`nitt.edu`) | none found | — | **robots.txt 404** | Static HTML | `/home/students/events/` = festival landing pages (Pragyan, Festember). Prose, no dates in markup. 1 `WebSite` JSON-LD | PENDING_REVIEW — low value |
| **NIT Warangal** (`nitw.ac.in`) | none found (a hyperlinking policy is referenced but not located) | — | `Disallow:` (empty) | **React SPA** (`/static/js/*.chunk.js`) — notifications load from an undocumented `/api/` | JS-only; would need Playwright or the undocumented API | PENDING_REVIEW — needs browser |
| **IIT Kharagpur** (WB) | `/legal-disclaimer` | *"Material on this site is subject to copyright protection unless otherwise indicated."* No automation clause | robots.txt request errored | `/event` page is JS/AJAX-populated (1.3 KB of text) | Announcements + events exist but need a browser | PENDING_REVIEW |
| **IIM Calcutta** (WB) | no general ToS found (only topic policies) | — | present, permissive | Drupal | `/announcements-0`, `/news` — server-rendered | PENDING_REVIEW — MBA case-competition value ⚠ |
| **BITS Pilani** | `/policies-procedures/` (institutional, not web ToS) | — | permissive | WordPress | `/events/`, `/pilani/events-festivals/` server-rendered | PENDING_REVIEW — good candidate |
| **IIIT Hyderabad** | `/privacy-policy` only | — | permissive | WordPress | `/events/` server-rendered **with visible dates** ("2 September 2026") | PENDING_REVIEW — best structured candidate |
| **IEM Kolkata** (WB) | `/terms-and-conditions/` | Short page; only *"IEM reserves its right to modify, alter and/or include any other Terms and Conditions that may be deemed fit in the interest of the Institution."* No scraping clause | permissive | WordPress | `/notice/` + tag pages (`workshops-seminars`, `news-articles`) | PENDING_REVIEW — good candidate |
| **Heritage Institute of Technology** (WB) | `QualityPolicy.aspx` (not a web ToS) | — | permissive | ASP.NET WebForms | `Events1.aspx`, `WorkshopSeminar.aspx`, `Announcement.aspx` | PENDING_REVIEW |

### 6.2 Catalog of 117 institutions — `docs/research/wp02-college-catalog.csv`

Two requests per site (robots.txt + homepage), 3 s apart. Columns: robots status/rules/crawl-delay/sitemap, home
status, visible-text size, detected technology, JSON-LD types, candidate event links, candidate policy links.

Coverage: **23 IITs · 31 NITs · 22 IIMs · 6 IIITs · BITS Pilani · 4 research institutes (IISc, IISER-K, ISI-K, IIEST)
· 9 private universities · 16 colleges (mostly West Bengal)**, including 31 West Bengal institutions.

Findings that shape WP-29:

- **No institute blocks crawlers wholesale** (0/117 have `Disallow: /` for `*`). 80/117 serve a robots.txt; 37 return
  404 or an error (absence = no restriction, but also no sitemap).
- **Crawl-delay is set by 5**: IIT Madras 10 s, IIIT Delhi 10 s, MANIT Bhopal 10 s, Guru Nanak IT 10 s, IIT Patna 1 s.
  The adapter must honour these over the 3 s default.
- **Zero of 117 publish schema.org `Event` JSON-LD.** JSON-LD that exists is Yoast/WordPress boilerplate
  (`WebSite`, `Organization`, `BreadcrumbList`). **The JSON-LD-first strategy (§4.8, §7.1 `"jsonld": true`) will not
  work for Indian campus sites** — per-site CSS selectors or regexes are unavoidable.
- **Technology:** 26 WordPress, 14 Drupal, 6 JS-only shells, 1 React SPA, ~70 hand-rolled/ASP.NET/static. WordPress
  and Drupal sites are the cheapest adapters (predictable list markup, often `/feed` or `/rss`).
- **16 sites could not be reached at all** — a real operational finding for a scraper that must not look "broken":
  - **Expired/invalid TLS certificates (8):** IIT Jodhpur, IIT Bhilai, IIM Nagpur, Jadavpur University, MAKAUT,
    University of Calcutta, NSUT Delhi, Future Institute (teamfuture.in). ⚠ **Never disable certificate validation**
    to work around these; record `error_kind = NETWORK` and surface it in Source status.
  - **403 to our User-Agent (3):** IIM Bangalore, IIM Bodh Gaya, SRM — WAF/bot protection. Treat as **BLOCKED**; do
    not retry with a different UA (§7.2 forbids UA rotation).
  - **DNS failures (2):** `www.ciem.ac.in`, `www.tmsl.ac.in` (domains may have changed).
  - Others: IIT Dharwad 400, NIT Arunachal 522, NIT Kurukshetra connection refused.
- **Competitions are mostly not on institute sites.** Campus fests (Techfest, Kshitij, Pragyan, Shaastra, Innothon)
  run on their **own domains** or list themselves on Unstop/Devfolio. The institute pages mostly carry seminars,
  notices and administrative announcements. **Recommendation: treat college sites as a low-yield, high-maintenance
  source; prefer fest domains and the platforms.**

### 6.3 Recommendation for the college path

**PENDING_REVIEW for all 117** — none may be enabled by default. For WP-29's "3 college sources", the best
candidates on evidence are **IIIT Hyderabad `/events/`**, **BITS Pilani `/events/`**, **IEM `/notice/`**
(plus **IIM Calcutta `/announcements-0`** if MBA case competitions are in scope). Each still needs, per site:
a robots re-check at run time, a look for a ToS/website policy, a `CONFIGURED_LISTING` config with selectors, and a
recorded `compliance_reviewed_by`/`compliance_notes` entry. Politeness for campus sites: **delay ≥ 5 s, ≤ 20
requests per run, cadence 6–24 h** (their content changes slowly and many run on modest hosting).

---

## 7. Cross-cutting notes for the architect

1. **WP-12 (Devpost adapter) conflicts with Devpost's ToS.** Needs an ADR or a re-scope (see §4).
2. **WP-13 (Devfolio/Unstop adapters):** Devfolio is feasible now; Unstop is blocked on a human reading the Terms.
3. **CLIST needs a human account + API key** before WP-11 can run against live data. Fixtures can be written from
   the documented schema meanwhile.
4. **`trust_rank` (§7.5) proposal:** organiser's own site (college/fest) > Devfolio (registration platform) >
   CTFtime > CLIST (aggregator).
5. **Cadence:** the default 15 min (§4.9) is too aggressive for every source reviewed here. Proposed defaults:
   CTFtime 60 min, CLIST 30–60 min, Devfolio 30–60 min, college sites 6–24 h.
6. **robots `Crawl-delay` must override the 3 s default** (CTFtime 10 s, IIT Madras 10 s). §7.2 doesn't say this.
7. **PII appears in source payloads** (Devfolio participants/judges/contact email, CTFtime organiser phone numbers).
   The adapter boundary must strip it before anything is stored — this is a WP-08/WP-09 acceptance criterion.
8. **Conflicting fields are real, not hypothetical:** a CTFtime event advertised "$500" in `prizes` and "₹50,000" in
   its description. Good first test case for §7.5 "Sources disagree".
