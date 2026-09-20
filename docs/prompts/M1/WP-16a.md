WP-16a — Discover screen: tabs, filter chips, dense result list, watchlist and hide (+ Playwright smoke)

Fresh session. Read ONLY: docs/PROGRESS.md · docs/handoff/WP-06.md · docs/handoff/WP-07a.md ·
docs/handoff/WP-15a.md · docs/handoff/WP-15b.md · docs/adr/ADR-0002-desktop-shell-tauri.md ·
docs/ARCHITECTURE.md §8.1 (the query model), **§16 (all of it)**, §12 (urgency thresholds), §10.2 (the
"Save/watch, hide events" row), §4.15, §17, §21 (R19, R27, R29) · docs/DECISIONS.md (D-06, D-08, D-25) ·
packages/contracts/src/{search,errors,permissions}.ts · apps/desktop/src/**/*.{ts,tsx} ·
apps/desktop/{index.html,vite.config.ts,tsconfig.json,package.json} · apps/backend/src/modules/search/**.
Do NOT read the Rust shell or the scraper modules; nothing here touches `src-tauri` (so R19 does not apply).

GROUND RULES (from the foundation you are building on):
- WP-06 shipped the tokens (`src/styles/tokens.css`, one `--ci-*` set, both themes, contrast measured in a
  test), the app shell + left rail, the cmdk palette (**a stub today — this WP makes it real**), the typed API
  client in `src/api/` (2 s timeout, R27), TanStack Query + Router, ErrorBoundary, toasts with an Undo slot,
  `<Skeleton>` (appears after 150 ms) and `<EmptyState>`. Reuse them; do not fork them.
- **§16.3: every status is icon + label (+ colour), never colour alone.** Urgency follows §12: Critical
  "Closes today" · High "≤ 3 days" · Medium "≤ 7 days" · Normal.
- **Vitest runs two projects**; UI tests are `pnpm vitest run --project desktop`. Vitest does not process CSS,
  so any stylesheet assertion reads the file with `node:fs` (as `tokens.contrast.test.ts` does).
- The UI never invents a query shape: it builds a real `EventQuery` from `packages/contracts` and zod-parses it
  before sending. One query model everywhere (§8.1).

BUILD:
1. Backend (the only backend work here — keep it small): per-user watchlist and hide.
   `PUT/DELETE /api/v1/events/:id/watchlist` (body: optional note) writing `watchlist_items`, and
   `POST /api/v1/events/:id/hide` / `/unhide` writing `event_user_state` (`is_hidden`, `hidden_reason?`).
   Both idempotent, both scoped to the calling user (a professor may only touch their own rows — §10.2),
   both covered by `fastify.inject` tests including the 401 and the cross-user 403/404 path.
2. `apps/desktop/src/features/discover/`: one `useEventSearch` hook over TanStack Query (cursor pagination,
   previous data kept while refetching so the list does not blink), the current `EventQuery` held in the
   router's search state so a later saved search can restore a screen verbatim, and a `query.ts` module that
   maps chips ↔ `EventQuery` in **one** place. Business logic stays out of components (CLAUDE.md).
3. Tabs (§16.2): **Featured** — Nearby · Closing soon · New · Recommended, each a named preset `EventQuery` in
   one module (Recommended = sort RELEVANCE with no text, which WP-15b already explains per result) ·
   **All events** grouped by event type · **Contest Calendar** — recurring rounds only
   (`includeRecurring: true`), grouped by week; a list, not a calendar grid. Tab state is keyboard-navigable
   (arrow keys within the tablist) and survives a drawer opening.
4. Filter-chip bar: event type · category · mode · distance (50/100/250/500/Anywhere, chip reads
   **"Within 300 km (in person)"**) · registration state · date range (chips show the **concrete** dates, A7) ·
   team size fits · free only · prize min · plus the per-field `includeUnknown` toggles **inside the chip they
   belong to** ("Include events with unknown fee"). Each chip opens a popover, is fully keyboard operable,
   announces the new result count politely, and there is a "Clear all". No filter exists in the UI that the
   contract cannot express.
5. Result card (dense, §16.2): title · organizer · type · mode/distance **"~180 km (straight line)"** ·
   countdown with urgency (icon + label + colour) · prize · team size · source icons **with accessible names** ·
   conflict marker ("Sources disagree", icon + label — it opens the drawer in WP-16b; here it is a marker and a
   test hook) · Save and Hide buttons. Page size 25 with "Load more" on the cursor — no virtualization.
6. Relevance reasons are shown, not dropped: a "Why relevant?" expander on the card listing WP-15b's reason
   texts. Reasons are already human-readable; the UI must not rewrite them.
7. Keyboard model (§16.3): `/` focuses the top-bar search — **it becomes a real input now** (WP-06 left it a
   button and asked; this is the answer) · Ctrl+K opens the palette, which now searches events live
   (debounced 200 ms, top 5 results + "See all results in Discover") alongside the existing commands ·
   **J/K** move the list selection (roving tabindex, selection visible, scrolls into view) · **Enter** opens the
   event (a drawer route placeholder in this WP — WP-16b fills it) **without losing the list's scroll
   position** · **S** saves · **A** is present but disabled with a tooltip "Assigning arrives with teams
   (M2)" — do not fake it · **Esc** closes whatever is open.
8. Optimistic updates with Undo (§16.3) for Save and Hide: the row updates immediately, a toast offers Undo
   (WP-06's toasts with an action stay 10 s), a failure rolls back and says what happened. A hidden event
   leaves the list with an "Hidden — Undo" toast, not a silent disappearance.
9. States: `<Skeleton>` rows for loads > 150 ms · `<EmptyState>` that names the next action ("No events match
   these filters — clear the distance filter" / "Nothing yet — sources run every 15 minutes") · an `ApiProblem`
   error state with Retry. The freshness pill stays WP-06's placeholder — **WP-16b owns it** (and R29 keeps the
   tray static until WP-30).
10. **Playwright** (§17's "Playwright smoke per screen"): add `@playwright/test` pinned exactly, configured
    with **`channel: 'msedge'`** against the installed Edge and `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` — **no
    Chromium download, ever, and nothing browser-related inside `pnpm verify`** (§4.15 budgets verify at
    < 2 min; same reasoning as R19). Config in `apps/desktop/playwright.config.ts`, specs in
    `apps/desktop/e2e/`, script `pnpm e2e` at the root. It runs against the **web build** (`vite preview`) plus
    a **real backend** on a throwaway `--data-dir` under `%LOCALAPPDATA%\CompIntel-dev`, seeded by a
    `pnpm seed:demo` script that reuses WP-15a's deterministic generator (a few hundred events is enough —
    do not seed 20k for E2E). One spec: sign in → Discover → apply two filters → J/K/Enter → Save → Undo.
    If Edge cannot be launched the script must fail with a clear message, never silently skip.

TESTS (jsdom project, in `pnpm verify` — the Playwright spec is not):
- chips → query: each chip produces exactly the expected `EventQuery` and round-trips back into chips;
  `includeUnknown` toggles land on the right field; the distance chip renders the D-06 wording; a date chip
  renders concrete dates.
- cards: urgency mapping at 0 / 2 / 6 / 30 days with a fake clock; every status has an icon **and** a text
  label (assert the accessible name, not the colour); the conflict marker appears only when `hasConflicts`.
- list behaviour: J/K move and Enter opens; the scroll position survives opening and closing the placeholder
  drawer; "Load more" appends without duplicates.
- optimistic: Save updates immediately and rolls back on a 500 with a visible error; Hide removes the row and
  Undo restores it in place.
- palette: typing searches, debounced, and "See all results" lands on Discover with that text in the query.
- **axe clean on Discover and on each of its three tabs**, with a chip popover open and with a long list
  rendered.
- backend: watchlist/hide idempotency, per-user scoping, unauthenticated 401.

ACCEPTANCE: `pnpm verify` green · **axe reports no violations on Discover and every tab** · **`pnpm e2e` green**
with the output pasted into the report, and state how Edge was resolved and that no browser was downloaded ·
the full keyboard path (`/`, Ctrl+K, J/K, Enter, S, Esc) demonstrated in the report · a manual run against a
seeded DB shows real events with distances and countdowns (say how you checked; a screenshot is welcome) ·
`pnpm audit:deps` reported · files < 400 lines.

OUT OF SCOPE: the detail drawer's contents — provenance, "Sources disagree", deadlines timeline, sources list,
change history, the freshness pill and the category override (**all WP-16b**) · assigning to a team (M2) ·
saved searches (WP-24) · the dashboard (WP-21) · the Assistant (M4) · anything under `src-tauri`.

Finish per CLAUDE.md (verify, PROGRESS.md ≤ 10 lines and < 150 total, docs/handoff/WP-16a.md, commit
"WP-16a: Discover screen — tabs, filters, cards, watchlist and hide", print the report). Anything the spec
leaves open goes under "Minor decisions"; anything architectural stops and goes under "Questions for the
architect".
