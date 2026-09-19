# Decisions register

Copied from `ARCHITECTURE.md` §1 (resolved) and §2 (open), v1.0-draft, 20 Sep 2026.
When the architect resolves an open question, update its row (status → RESOLVED + answer + date) and record the decision in an ADR where it affects architecture.

## Resolved decisions

| ID | Status | Decision | Architectural consequence |
|---|---|---|---|
| D-01 | RESOLVED | UI → API → Application services → DB. UI never touches the DB. | Separate backend process; versioned HTTP API; shared contracts package. |
| D-02 | RESOLVED | Pilot backend runs on one machine; must be movable to an always-on campus machine without rewrite. | "Host mode" first; "Client mode" later uses the same backend build and API. |
| D-03 | RESOLVED | Open department: professors see all students, teams, competitions; only owner/co-mentors edit their teams & workflows; admins full access. | Code-defined RBAC + ownership predicates (§10). |
| D-04 | RESOLVED | Students ↔ teams, events, mentors are many-to-many. | Join tables with history (`from/to` timestamps). |
| D-05 | RESOLVED | Core app runs on 8 GB RAM, CPU-only. AI targets 16 GB. GPU optional. | LLM in a separate, on-demand process; AI tiers (§5). |
| D-06 | RESOLVED | Distance = straight-line from the configured campus, shown "~180 km (straight line)"; filters 50/100/250/500 km/Anywhere. | Offline gazetteer; distance derived at query time. |
| D-07 | RESOLVED | Local accounts created by admin; Argon2id; sessions; auto-lock; roles ADMINISTRATOR, PROFESSOR; no SSO in MVP. | `AuthProvider` boundary so SSO can be added later. |
| D-08 | RESOLVED | MVP event types: hackathons, ideathons, innovation challenges, CTFs, major coding contests. Recurring rated rounds must not dominate the feed. | `event_series` + `is_recurring_round`; separate Contest Calendar. |
| D-09 | RESOLVED | In-person → India only; online → worldwide; hybrid → by physical location. Configurable. | Single geography-policy module (§7.4). |
| D-10 | RESOLVED | Sources: Devfolio, Unstop, Devpost, CTFtime, CLIST + manual creation + URL import; college sites via configurable adapters afterwards. ToS/robots check before any scraper; no bypassing. | Adapter framework + compliance gate enforced in code (§7.2). |
| D-11 | RESOLVED | AI is read-only in MVP. | Fixed set of read-only tools; actions are Phase 2 with confirmation. |
| D-12 | RESOLVED | Files are referenced (paths/URLs), never copied, in MVP. | `resources` table; open allowlist (§13). |
| D-13 | RESOLVED | Daily auto backup, keep 14; manual backup/restore; CSV/XLSX export; configurable destination; warnings. | Backup service (§14). |
| D-14 | RESOLVED | Close-to-tray (default on, can be disabled); scheduler keeps running; "Exit completely" stops everything. | Tauri tray + backend supervision (§3.2). |
| D-15 | RESOLVED | Categories from source tags + deterministic rules; admin edits list; professors override per event. AI classification is Phase 2. | `categories`, `category_rules`, `event_categories.origin`. |
| D-16 | RESOLVED | ₹0 budget for paid APIs. | Local LLM, offline geocoding, no paid scraping/search/routing. |
| D-17 | RESOLVED | Code signing not mandatory for the pilot unless the environment requires it. | See §18. |
| D-18 | RESOLVED | Recommendations are rule-based and explainable ("Why relevant?"). | Deterministic relevance scorer (§8.4). |
| D-19 | RESOLVED | Notifications in-app only; rules not implemented until ownership is confirmed. | Schema ready; engine in WP-23 after Q4. |
| D-20 | RESOLVED | Primary mentor + co-mentors; admin can transfer ownership with history intact. | Mentor join tables with validity periods; transfer use-case (§10.4). |
| D-21 | RESOLVED | Outcomes are part of the competition lifecycle (exact MVP fields open). | `engagement_outcomes`. |
| D-22 | RESOLVED | Student data minimization. | Minimal field set; phone disabled by default; erasure path. |
| D-23 | RESOLVED | Offline works for everything except scraping, URL import and external links; offline is not a failure. | `SKIPPED_OFFLINE` run outcome; offline banner, not error. |
| D-24 | RESOLVED | Audit log for administrative accountability. | Append-only `audit_log` written in the same transaction as each change. |
| D-25 | RESOLVED | Light/dark following Windows; accessibility baseline. | Design tokens + system theme sync (§16). |

## Open questions

| # | Status | Question | Blocks | Proposed default (used until answered) |
|---|---|---|---|---|
| Q1 | OPEN | Pilot host: one shared PC or individual professor machines? Is off-campus access required? | Client mode (post-M5); network security | Host mode on one machine. No off-campus access in MVP (later via university VPN — never exposed to the internet). |
| Q2 | OPEN | Pilot facts: date, number of professors, host machine specs, who installs, IT restrictions (Smart App Control, WDAC/AppLocker, proxy), who maintains scrapers. | WP-26 model choice, WP-31 packaging | Taken from WP-00/WP-01 recon of the build machine until the pilot host is known. |
| Q3 | OPEN | Campus name and coordinates. | WP-07 setup wizard (entered at runtime — not blocking code) | — |
| Q4 | OPEN | Notification recipients and thresholds. | WP-23 | Competition/stage/task deadlines → primary + co-mentors; watched-event changes → users who saved it; saved-search matches → owner; scraper/backup failures → admins. Thresholds 7 / 3 / 1 days + due day + overdue. |
| Q5 | OPEN | Permission defaults in §10 (student profile edits, event corrections, co-mentor rights). | WP-07, WP-17, WP-19 | As in the §10 matrix. |
| Q6 | OPEN | Can teams include students from other colleges? (Other departments are already allowed.) | WP-17/18 | Supported in the data model (`is_external`); UI behind an admin setting, off by default. |
| Q7 | OPEN | Outcome fields in MVP. | WP-21 | Team-level: result, rank, prize text, certificate reference, result URL, notes. |
| Q8 | OPEN | Student personal fields & consent; does the university have a data-protection policy/officer? | WP-17 | Fields as in §6.2; phone off by default; record "privacy notice acknowledged" date. |
| Q9 | OPEN | Audit log retention and visibility. | WP-30 | Admins see all; professors see activity timelines of records they can view; retain 3 years (login events 1 year). |
| Q10 | OPEN | Does university IT have a code-signing certificate or signing service? Will the project be open source? | WP-31 | Unsigned internal pilot if Smart App Control/WDAC allow (§18). |
| Q11 | OPEN | University identity provider (Google Workspace / Microsoft 365). | Post-MVP SSO | — |
| Q12 | OPEN | Hybrid events whose physical venue is outside India: show as "online participation possible" or hide? | WP-08 | Show, labelled "Hybrid — online participation" (configurable). |
| Q13 | OPEN | Sources whose ToS forbid automated access (outcome of WP-02): request permission, rely on manual/URL import, or drop? | WP-13 | Manual/URL import only, plus a permission request email. |
