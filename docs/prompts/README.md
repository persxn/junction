# Work-package prompts, by milestone

One file per work package. Each is **self-sufficient**: a fresh Claude Code session that has never seen
this project runs exactly one of these, top to bottom, and reports back. That is why they repeat context
and name the files to read — a prompt that assumes prior conversation is a broken prompt.

Run order is the order in the tables below. Do not start a WP whose predecessor has not landed and been
reported, and do not run two in one session.

## M0 — Foundations · *app launches, signs in, survives crashes* · **DONE**

| Prompt | WP |
|---|---|
| `M0/WP-06.md` | UI foundation |
| `M0/WP-07a.md` | Auth core |
| `M0/WP-07a2.md` | WP-07a follow-up |
| `M0/WP-07b.md` | Setup wizard + user administration (closed M0) |

Earlier M0 prompts (WP-00…WP-05b) predate the `docs/prompts/` folder; their record is the handoff in
`docs/handoff/`. Milestone account: `docs/handoff/M0.md`, architect's review: `docs/handoff/M0-review.md`.

## M1 — Events · *real events, trustworthy and searchable* · **DONE**

| Prompt | WP | Notes |
|---|---|---|
| `M1/pre-M1.md` | Consolidation refactor | **Run first.** No behaviour change. Everything after it assumes the time layer, the layer-boundary lint, `withAudit`, module-owned settings and the golden-fixture harness exist. |
| `M1/WP-08a.md` | Event schema, `EventCandidate`, normalization | STEP 0 claims §21 R48–R52, spec 1.1.7 |
| `M1/WP-08b.md` | Gazetteer, geocoder, distance, geography + event-type policies | R53–R57, spec 1.1.8 |
| `M1/WP-09a.md` | PoliteHttpClient, compliance gate, source seeds, scrape runs, snapshots | R58–R61, spec 1.1.9 · first WP to register a job (R22) |
| `M1/WP-09b.md` | CTFtime adapter | R62–R63, spec 1.1.10 · one manual live smoke run |
| `M1/WP-10.md` | Dedup / merge / unmerge, field resolution, change detection | R64–R66, spec 1.1.11 |
| `M1/WP-11.md` | CLIST adapter + recurring-round detection → Contest Calendar | Fixture-driven; live runs need **U4** (API key) |
| `M1/WP-12.md` | Devfolio adapter | Public pages only; never `api.devfolio.co` |
| `M1/WP-13.md` | Unstop adapter **or** a docs-only verdict | Branches on **U3** (Terms unread) |
| `M1/WP-14.md` | Manual event creation + URL import | Devpost URL → manual form, zero requests |
| `M1/WP-15a.md` | `EventQuery`, FTS5 + trigram, aliases, typo vocabulary, perf test | |
| `M1/WP-15b.md` | Category rules, facets, ranking, relevance reasons | |
| `M1/WP-16a.md` | Discover UI | |
| `M1/WP-16b.md` | Detail drawer, provenance, conflicts, freshness | Closes M1 |

If a WP finds its reserved ruling numbers or spec version already taken, it uses the next free ones and
says so in its report.

## M2 — People & work · *assign an event to a team and track it* · **released**

| Prompt | WP | Notes |
|---|---|---|
| `M2/pre-M2a.md` | UI & shell fault fixes | **Run first.** Writes through the F9 fallback, `open_external`, sealed sessions, verify < 2 min. Rust checks (R19). |
| `M2/pre-M2b.md` | Ingestion & search corrections | R75, R77, R79–R82, R85, R87, R88; owed live runs |
| `M2/WP-17.md` | Students, tags, mentorships, CSV/XLSX import | R91–R93, spec 1.1.15 · adds `papaparse` + `exceljs` |
| `M2/WP-18.md` | Teams, members, mentors, skill coverage | R94–R95, 1.1.16 |
| `M2/WP-19.md` | Competitions, status machine, roster, assign flow, pipeline board | R96–R98, 1.1.17 |
| `M2/WP-20a.md` | Workflows, stages, tasks, progress & schedule health | R99–R101, 1.1.18 |
| `M2/WP-20b.md` | Resources + shell-side open allowlist | R102–R103, 1.1.19 · Rust checks |
| `M2/WP-21.md` | Outcomes, ownership transfer, student history | R104–R105, 1.1.20 · closes M2 |

## M3 — Time · *nothing slips* · **released**

| Prompt | WP | Notes |
|---|---|---|
| `M3/WP-22.md` | Deadline read model, Deadline Radar, Dashboard | R106–R107, 1.1.21 |
| `M3/WP-23.md` | Notification engine, inbox, SSE, tray count + toasts | R108–R111, 1.1.22 · Rust checks |
| `M3/WP-24.md` | Saved searches, new-match alerts, interests, Recommended | R112–R113, 1.1.23 · closes M3 |

Every M2/M3 prompt ends with a **UI fault sweep** of the screens it touches and links to.

## M4, M5

M4 (WP-25a…27b) and M5 (WP-28…32) prompts are written after M3's `docs/` comes back. WP-33 (M4.5) is
already released:

## M4.5 — Delight · *the app people want to open*

| Prompt | WP | Notes |
|---|---|---|
| `M4/WP-33.md` | Appearance system (Catppuccin palettes, effect tiers, motion & glow) + Insights surface | Runs after WP-27b, **immediately before M5**. ADR-0019, rulings R67–R69. |

## M4.6 — Students · *a student can use Junction with no account*

| Prompt | WP | Notes |
|---|---|---|
| `M4/WP-34.md` | STUDENT role, password-less guest, "Myself" / "An institution" first run, release v0.10.0 | **released** · Owner decisions O-4…O-7 · R130–R135, spec 1.1.30 · migration 0033 · Rust checks if `src-tauri` changes |

## M4.7 — Sources · *more events, every one reviewed first*

| Prompt | WP | Notes |
|---|---|---|
| `M4/WP-35.md` | Compliance review of nine candidate sites; adapters for Codeforces, MLH, HackerEarth, Knowafest if they pass; release v0.11.0 | Owner decision O-8 · R136–R141, spec 1.1.31 · migration 0034 (`sources` rebuild, deferred FKs) · a few live requests allowed (R137) |


## Writing a new prompt

Match `M0/WP-07b.md` or `M1/WP-09a.md`. The shape is: a title line · `Fresh session. Read ONLY: …`
(an explicit, closed reading list) · an optional `STEP 0` recording the architect's rulings into
`ARCHITECTURE.md` · numbered `BUILD` steps · a `TESTS` block naming the awkward cases, not the happy path ·
one `ACCEPTANCE` line · one `OUT OF SCOPE` line, which matters as much as the scope · and a closing
`Finish per CLAUDE.md (…)` line with the exact commit message. Terse and imperative throughout: a prompt
that says "consider" has handed a decision back to a session that has less context than the architect did.
