# WP-16a — Discover screen: tabs, filter chips, dense result list, watchlist and hide (+ Playwright smoke)

**Status: DONE** · 22 Sep 2026 · `pnpm verify` green, **3030 tests** (2974 at WP-15b), 112 s ·
`pnpm e2e` green · `pnpm audit:deps` clean · one new dependency (`@playwright/test`, dev).
Nothing under `src-tauri` changed (R19 does not apply).

## 1. Acceptance

| Criterion | Evidence |
|---|---|
| axe clean on Discover and every tab | `DiscoverPage.test.tsx` › *accessibility*: Featured with 30 cards loaded and a "Why relevant?" open, with the Registration popover open, then All events and Contest Calendar |
| chips → query, round trip | `query.test.ts`: each of the 9 chips writes exactly its `EventQuery` fragment, reads the same value back, renders its label, and passes `EventQuery`; `includeUnknown` lands on its own field; cleared chips leave no trace |
| distance / date wording | "Within 250 km (in person)" (D-06); "Runs 1 Oct 2026 – 31 Oct 2026" (A7, concrete dates) |
| urgency at 0/2/6/30 days, fake clock | `urgency.test.ts` + `EventCard.test.tsx` (accessible text "Critical: Closes today", "High urgency: Closes in 2 days", "Medium urgency: Closes in 6 days", "Open: Closes 22 Oct", each with an icon) |
| conflict marker only on conflicts | `EventCard.test.tsx`, `DiscoverPage.test.tsx` |
| J/K/Enter, scroll kept, Load more | `DiscoverPage.test.tsx` › *the keyboard*: `main.scrollTop` 640 survives open + Esc; focus returns to the card; Load more → 30 unique cards, facets asked for on page 1 only |
| optimistic Save/Hide | Save shows at once and rolls back on a 500 with "Could not save …"; Save → Undo; Hide removes the row with "Hidden — …" + Undo restoring it **at the same index** |
| palette | typing "Event 12" makes **one** debounced request (limit 5); "See all results in Discover" lands on Discover with `text: "Event 12"` |
| backend | `routes/user-state.test.ts`: 401 on all four routes, idempotent PUT/DELETE/hide, per-user scoping (Bob's DELETE leaves Alice's row; Alice's hide is invisible to Bob), 404 `EVENT_NOT_FOUND` for hidden/unknown events with nothing written, unknown body keys refused |
| files < 400 lines | largest new file `ChipEditor.tsx` 350 |

### `pnpm e2e` (outside verify)

```
Running 1 test using 1 worker
  ok 1 e2e\discover.spec.ts:53:1 › sign in → Discover → two filters → J/K/Enter → Save → Undo (2.3s)
e2e teardown: scrape_runs = 0 (no event website was contacted)
  1 passed (9.6s)
```

- **Edge:** `channel: 'msedge'` → the installed `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`.
  Global setup launches it first and fails with a clear message if it cannot.
- **No browser downloaded:** `@playwright/test@1.63.0` was added with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` (3 packages,
  no browser); the config sets the variable too. `%LOCALAPPDATA%\ms-playwright` holds Chromium builds dated
  **24 Aug 2026**, from before this project; nothing uses them.
- **Nothing contacted:** `seed:demo` switches all 7 sources off, so the backend registers no scrape job; the teardown
  reads `scrape_runs` = 0 from the run's database.

### Keyboard path (each step asserted)

`/` focuses the top-bar search box, and Enter searches Discover. Ctrl+K opens the palette, which searches events live.
J/K move the list selection (roving tabindex, scrolled into view). Enter opens the drawer placeholder over the list.
Esc closes it, and focus returns to the card with the scroll position kept. S saves the selected card.
A is present but disabled, named "Assign — Assigning arrives with teams (M2)". Esc also closes chip popovers
(focus back on the chip) and the palette. Tests: `DiscoverPage.test.tsx`, `CommandPalette.test.tsx`; E2E does
J/J/K, Enter, Esc, S, Undo in Edge.

### Manual check

The E2E screenshot (`%LOCALAPPDATA%\CompIntel-dev\e2e\discover.png`, `E2E_SCREENSHOT=…`, not committed) shows the
seeded backend with real ranked events: "~202 km (straight line)", "Closes 24 Nov", "₹3,56,000", "Team 3–7", the
chips "In person" and "Within 500 km (in person)", and "34 events".

## 2. What shipped

| Area | Files |
|---|---|
| Contracts | `user-state.ts` (`WatchlistInput`, `WatchlistEntry`, `HideInput`, `EventUserState`); `filters.ts` (`EventFilters` = `EventQuery` without cursor/limit/sort); `RankedEventListItem.watchlisted` |
| Backend | `modules/events/user-state.ts`, `routes/user-state.ts` (`PUT/DELETE /events/:id/watchlist`, `POST /events/:id/hide`, `/unhide`); search marks each card `watchlisted` (one query per page) |
| Discover | `features/discover/`: `query.ts` (chips ↔ query, the one place), `presets.ts` (tabs), `search-state.ts` (router state), `use-event-search.ts`, `use-event-actions.ts` + `cache.ts` (optimistic edits), `urgency.ts`, `format.ts`, `labels.ts`, `grouping.ts`, `DiscoverPage`, `Tabs`, `FilterBar`, `Popover`, `ChipEditor`, `EventList`, `EventCard`, `EventDrawer` (placeholder route), `use-palette-events.ts` |
| Shell | `TopBar` (real search input + Ctrl+K button), `AppShell` (search → Discover), `CommandPalette` (live event results), router (`/discover` with `validateSearch`, child `/discover/event/$eventId`), `lib/use-now.ts`, `api/search.ts` |
| E2E | `apps/desktop/playwright.config.ts`, `e2e/{global-setup,global-teardown,environment,discover.spec}.ts`, `e2e/tsconfig.json`; root `pnpm e2e`; `pnpm seed:demo` (`tools/perf/search/src/seed-demo.ts`, seeding shared with perf in `seed.ts`) |

## 3. Deviations from the prompt

1. **The E2E stubs the Tauri IPC in the page.** The web build gets its connection only through
   `backend_connection`, so the spec defines `window.__TAURI_INTERNALS__` answering `backend_status` /
   `backend_connection` with the real backend's URL and secret. Everything past that boundary is real (HTTP, auth,
   search, Save, Undo). §4.15 already puts the shell outside web E2E.
2. **The Contest Calendar cannot be "recurring rounds only":** `EventQuery` has no such filter, and the rule says no
   UI filter the contract cannot express. The tab is `includeRecurring: true` + `eventTypes: [CODING_CONTEST, CTF]`,
   by start date, grouped by week (Q1).
3. **`watchlisted` added to the search card** (`RankedEventListItem`). Save needs to show its state, and nothing
   else carries it.
4. **WP-06's top-bar button is now a real input** (WP-06 asked; this WP answered). Its tests were updated, and the
   palette opens from a Ctrl+K button beside it.

## 4. Minor decisions

1. Presets: Nearby = sort DISTANCE within **100 km** (a D-06 ring; the chip can change it) · Closing soon = state
   CLOSING_SOON by deadline · New = NEWEST · Recommended = RELEVANCE, no text · All events = DEADLINE, grouped by
   type. Every tab sends `excludeHidden: true`. A chip wins over its tab's preset value.
2. Filters live in the router search state as `{ tab, view, filters }`; an unparseable value falls back to the
   default rather than breaking navigation. Top-bar/palette text lands in `filters.text` on the current tab.
3. Fee chip: "Free only" or a maximum in ₹. "Include events with unknown fee" rides only with a maximum (A6: free
   never matches unknown). Money chips are INR.
4. Facet counts show next to options (from page 1); category options come from the facets, so the chip needs no
   admin-only endpoint.
5. Optimistic edits touch every cached list, not only the visible one; Hide's Undo restores each list's own
   position. Save/Hide are not audited (personal, §10.2 marks only shared writes "audited").
6. The drawer is a child route over the list (the list never unmounts), with focus to its heading and back to the
   card on close. Its title comes from the cached card; contents are WP-16b's.
7. Month names are fixed ("Sep", matching the backend's reasons); dates are Asia/Kolkata. The countdown ticks via
   `useNow` (once a minute), not `Date.now()` in render.
8. E2E hygiene: throwaway data dirs under `%LOCALAPPDATA%\CompIntel-dev\e2e`, previous runs removed at setup;
   the backend stops gracefully (stdin lifeline), then the DB is read with retries (Windows releases handles late).

## 5. Known issues / tech debt

- **`pnpm verify` is 112 s** against §4.15's < 2 min. The Discover integration tests (axe in jsdom) cost ~8 s under
  load and needed a 20 s per-test timeout.
- The web bundle is 649 kB (199 kB gzip): Vite warns about the 500 kB chunk; still well under §4.2's 1.5 MB gzip.
- The rail's "CompIntel" brand text sits outside any landmark (axe's `region` rule on `document.body`); the shell
  tests, and these, scope axe to the app container. It is a one-line WP-06 fix.
- Save/Hide can't work on a machine that needs the shell fallback: the R27 proxy is GET-only, and POST search too.
  This is pre-existing (R27), but Discover is the first screen that depends on non-GET calls.
- WP-15b's perf question (Q1 there) still stands; Discover's first page is the unfiltered RELEVANCE query it measured.

## 6. Questions for the architect

1. **Contest Calendar** (deviation 2): add `recurringOnly` (or `isRecurringRound`) to `EventQuery`, or accept the
   contest-types approximation?
2. **R27 and non-GET calls:** should the shell proxy forward POST/PUT/DELETE for `/api/v1/search` and `/api/v1/events/*`,
   or is "not available on this machine" acceptable for the F9 case?
3. `watchlisted` on the search card (deviation 3): acceptable, or should saved state come from a separate endpoint?

## 7. Files the architect should review

1. `apps/desktop/src/features/discover/query.ts`
2. `apps/desktop/src/features/discover/use-event-actions.ts` (+ `cache.ts`)
3. `apps/desktop/src/features/discover/presets.ts`
4. `apps/desktop/e2e/global-setup.ts`
5. `apps/backend/src/modules/events/user-state.ts`

## 8. Suggested next step

WP-16b: the detail drawer's contents (provenance, "Sources disagree", deadlines, sources, history), the freshness
pill and the category override (`CategoriesRepository.setManual` exists since WP-15b).
