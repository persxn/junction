WP-16b — Event detail drawer (provenance, conflicts, timeline, history), freshness pill + source status, category override · closes M1

Fresh session. Read ONLY: docs/PROGRESS.md · docs/handoff/WP-16a.md · docs/handoff/WP-15a.md ·
docs/handoff/WP-15b.md · docs/handoff/WP-10.md · docs/handoff/WP-09a.md · docs/handoff/WP-06.md ·
docs/ARCHITECTURE.md **§7.5** (field resolution, conflicts), §7.6 (missing/cancelled/ended), §7.7 (failure
messages), §7.2 (trust rank + **attribution**), §6.2 (`event_field_claims`, `event_deadlines`,
`event_changes`, `event_categories`, `source_state`, `scrape_runs`), **§16 (all of it)**, §12, §10.2, §13
("Opening safely"), §17, §21 (**R29**, R27, R19) · docs/DECISIONS.md (**D-15**, **D-32**, D-06) ·
packages/contracts/src/{search,errors,permissions}.ts · apps/desktop/src/** ·
apps/backend/src/modules/{events,search,sources,categories}/**.

GROUND RULES:
- This drawer is where the project's trust story becomes visible. **Nothing is averaged, invented or
  smoothed over** (§7.5): when sources disagree the user sees each value, who said it, when, and which one the
  app selected and why.
- **R29 — the tray stays static until WP-30.** The freshness surface you build here is the **in-app** one only:
  the §16.1 top-bar pill and its popover. Do not touch the Rust shell (so R19 does not apply).
- **D-32 — attribution on every event.** The sources list names each source with its attribution text.
- **D-15 — professors override categories per event, manual beats rules.** WP-15b's re-classification must
  never undo what is done here; prove it with a test.
- Relative times ("verified 2 h ago", "Updated 4 min ago") come from the injectable `Clock` / a fake clock in
  tests — never `new Date()` inline, and never a bare timestamp where a professor needs a feeling for freshness.

BUILD:
1. Backend — `GET /api/v1/events/:id/detail`, extending WP-15a's core event with:
   **claims** grouped by field (`event_field_claims`: value, source name, `trust_rank`, `observed_at`,
   `is_selected`), **conflicts** (`has_conflicts` plus, per disagreeing field, every claimed value with its
   source and the reason the selected one won — active override > highest trust rank > most recent, §7.5),
   **deadlines** (`event_deadlines` ordered, carrying `kind`, label, `due_at`, `precision`, `origin`),
   **sources** (source name, url, last fetched, attribution text), **categories** (with `origin` and
   `is_suppressed`), and **history** (`event_changes`, newest first, cursor-paged, with a rendered
   field/cause label). One round trip — the drawer must not fan out into six requests.
2. Backend — `GET /api/v1/sources/status`: per source, name, `last_success_at`, `next_due_at`,
   `consecutive_failures`, the last run's `outcome`/`error_kind` mapped to the **§7.7 user-facing message**,
   and an overall `updatedAt` = the newest successful run. Visible to professors; compliance status and
   notes are admin-only fields in the same response (omitted, not nulled, for a professor).
3. Backend — category override: `PUT /api/v1/events/:id/categories` adding `origin = MANUAL` rows and setting
   `is_suppressed = true` for removals, **audited** (§10.2: professor ✓ audited), with optimistic `version`
   concurrency → 409. Adding back a suppressed category clears the suppression.
4. UI — the drawer (`apps/desktop/src/features/discover/detail/`), opening over WP-16a's list so **the list
   keeps its place**: focus moves into the drawer, is trapped, Esc closes and returns focus to the originating
   card; 120–200 ms ease-out honouring `prefers-reduced-motion`; the open event id lives in the router search
   state so it is deep-linkable and survives a refetch.
   Sections per §16.2: **header** (title, organizer, key dates, countdown with urgency) · **actions** (Save,
   Hide, Open registration — external links open through the §13 allowlist path, never in the WebView; Assign
   still disabled with its M2 tooltip) · **facts grid with provenance tooltips** — every fact that has a claim
   carries "as stated by Devfolio, verified 2 h ago", keyboard reachable, not hover-only · **"Sources
   disagree" panel** · description (sanitized) · **deadlines timeline** (precision-aware: "by 27 Sep" when the
   time is unknown) · **sources list with attribution** · **change history** with "load older".
5. UI — the "Sources disagree" panel: shown whenever `has_conflicts`, one block per field, each claimed value
   with its source and observation time, the selected value marked **with the reason it won**, and a one-line
   explanation that the app never merges conflicting values. Icon + label, never colour alone. It is the
   §19 acceptance criterion — give it a stable test id and its own test file.
6. UI — the freshness pill (§16.1), replacing WP-06's placeholder: "Updated 4 min ago" (icon + label), click or
   Enter opens a per-source status popover listing each source with an icon + label state (OK · Failing ·
   Paused by policy · Skipped, offline), its last success, its next run and the §7.7 message on failure.
   Refresh it from the existing SSE invalidation if WP-09a emits scrape events, otherwise a 60 s refetch —
   say which you used and why. Offline (§7.7) shows the info banner wording, not an error.
7. UI — category chips in the drawer show their origin (source tag · rule · manual) as icon + label, with an
   override control (add/remove) using optimistic update + Undo, and a hint that manual choices survive
   re-classification. Hidden for a user without the permission, not broken.
8. Fixtures: a **seeded conflict fixture** — one event with three sources disagreeing on the registration
   deadline (> 1 h apart), the prize and the team size — under `apps/backend/test/fixtures/conflicts/` (reuse
   WP-10's scenarios if they are already there rather than inventing a second set), loadable by
   `pnpm seed:demo` from WP-16a so the E2E run and a manual demo both show it.

TESTS (jsdom + node projects, in `pnpm verify`; the Playwright spec is not):
- **the acceptance criterion:** rendering the drawer on the conflict fixture shows **"Sources disagree"** with
  every claimed value, each source's name, and the selected value marked with its reason — one test per
  conflicting field. An event without conflicts renders no panel.
- provenance: each fact with a claim has the "as stated by <source>, verified <relative time>" text under a
  fake clock; a fact with no claim has no tooltip; the tooltip is reachable by keyboard.
- deadlines timeline: precision handling (exact time vs day-only), ordering, an origin MANUAL deadline labelled.
- history: newest first, "load older" appends, causes rendered as words (SCRAPE / OVERRIDE / MERGE / MANUAL).
- freshness: "Updated 4 min ago" under a fake clock; a failing source shows the §7.7 message with an icon and a
  label; an offline state shows the info banner, not an error; the popover is keyboard operable.
- override: adding and removing a category persists, is audited, shows Undo, and **survives a WP-15b
  re-classification run** (backend test: suppress → edit rules → re-classify → still suppressed).
- drawer mechanics: Esc returns focus to the card; the list's scroll position is unchanged after open/close;
  **axe clean with the drawer open**, with the conflict panel open and with the freshness popover open.
- backend: `/events/:id/detail` shape on the conflict fixture (golden); a professor's response omits the
  compliance fields; `/sources/status` maps each `error_kind` to its §7.7 message; 409 on a stale `version`.
- Playwright: extend WP-16a's smoke — open the conflict fixture from the list, assert "Sources disagree" is
  visible, Esc returns to the list with its scroll intact. Still `channel: 'msedge'`, still outside `pnpm verify`.

ACCEPTANCE: `pnpm verify` green · **"Sources disagree" visible on the conflict fixture**, in both the unit test
and the Playwright run, with the output pasted into the report · axe clean on Discover with the drawer open ·
`pnpm e2e` green · a manual run against the seeded DB shows the drawer, a provenance tooltip, the conflict
panel, the deadlines timeline and the freshness popover (say how you checked; screenshots welcome) ·
`pnpm audit:deps` reported · files < 400 lines.

OUT OF SCOPE: the tray badge, tooltip phase and tray freshness line (**R29 → WP-30**) · the admin Sources
screen with Run now / Test extraction (WP-30) · duplicate review UI (WP-... admin, later) · editing scraped
event fields or marking cancelled (admin correction flow, later) · assigning to a team (M2) · notifications
(WP-22/23) · saved searches (WP-24).

Finish per CLAUDE.md (verify, PROGRESS.md ≤ 10 lines and < 150 total, docs/handoff/WP-16b.md, commit
"WP-16b: event detail drawer, freshness pill and category override", print the report). **This WP closes
milestone M1** — end the report with a one-paragraph demo script for the product owner: launch → Discover →
filter to "hackathons within 250 km closing in 7 days" → a typo'd search that self-corrects → open an event →
provenance → "Sources disagree" → save it → the freshness pill's source status.
