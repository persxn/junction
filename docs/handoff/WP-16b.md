# WP-16b — Event detail drawer (provenance, conflicts, timeline, history), freshness pill, category override

**Status: DONE** · 22 Sep 2026 · closes **M1** · `pnpm verify` green · `pnpm e2e` green ·
`pnpm audit:deps` clean · **no new dependencies**. Nothing under `src-tauri` changed (R19 does not
apply; R29 kept this to the in-app surface).

## 1. Acceptance

| Criterion | Evidence |
|---|---|
| **"Sources disagree" on the conflict fixture** | `ConflictPanel.test.tsx` — one test per conflicting field (registration deadline, prize, team size), each asserting every claimed value **and** its source; `EventDrawer.test.tsx` renders it over the real Discover screen; `detail.test.ts` / `event-detail.test.ts` prove the payload. An event with no conflicts renders no panel (`container` is empty) |
| Selected value marked with its reason | `HIGHEST_TRUST` → "Selected because hackxyz-site is the most trusted source stating it", with `Shown by CompIntel:` as the screen-reader marker beside the icon (never colour alone) |
| Provenance, keyboard-reachable | `sections.test.tsx`: "as stated by hackxyz-site, verified 2 h ago" under a fake clock; the marker is a `button` with `aria-expanded`, opens on Enter, lists all three claims; a computed fact (distance) carries none |
| Deadlines timeline | order, `DATETIME` shows a time, `DATE` shows "by 7 Oct" and never "00:00" (ADR-0015), an `origin: MANUAL` row says "Added by hand" |
| History | newest first, causes as words ("Found by a scrape", "Merged with a duplicate", "Corrected by hand"), "Load older" appends; no enum value reaches the screen |
| Freshness | "Updated 4 min ago" under a fake clock; a failing source shows §7.7's sentence with icon + label; offline is the **info** banner, not an error; Enter opens the popover and Esc closes it with focus back on the pill |
| Override survives re-classification | `categories.test.ts`: suppress → `requestReclassification` → `processPending` → still suppressed; one audit row per change, none for a no-op; 409 on a stale `version` writes nothing |
| Drawer mechanics | Esc returns focus to the card, `main.scrollTop` 640 survives open + close, 40 Tabs never leave the panel |
| **axe clean with the drawer open** | `EventDrawer.test.tsx` — drawer + conflict panel + a provenance disclosure + the freshness popover, all open at once |
| Backend | `/events/:id/detail` parsed with `EventDetailView` over a real socket; a professor's `/sources/status` **omits** `complianceStatus`/`complianceNotes`, an admin's carries them; `sourceHealthOf` per outcome; 404/401/409 |
| Files < 400 lines | largest new file `EventDrawer.tsx` 260; `packages/contracts/src/sources.ts` was split to stay under (see §3.4) |

### The acceptance criterion, as the unit test prints it

```
 ✓ the "Sources disagree" panel
   ✓ appears on the conflict fixture, and says nothing is merged
   ✓ is absent on an event the sources agree about
   ✓ shows every claimed registration deadline with the source that stated it
   ✓ shows every claimed prize with the source that stated it
   ✓ shows every claimed team size with the source that stated it
   ✓ marks the selected value and says why it won
   ✓ separates §7.5's material disagreements from the wording ones
   ✓ is accessible
```

### `pnpm e2e` (outside verify)

```
Running 2 tests using 1 worker
  ok 1 e2e\discover.spec.ts:55:1 › sign in → Discover → two filters → J/K/Enter → Save → Undo (2.3s)
  ok 2 e2e\discover.spec.ts:127:1 › the conflict fixture opens a drawer that says "Sources disagree" (1.8s)
e2e teardown: scrape_runs = 0 (no event website was contacted)
  2 passed (12.1s)
```

The second test opens the **seeded** fixture from the list, asserts the panel names all three
sources, then presses Esc and checks the list's scroll position and the card's focus are unchanged.

### `pnpm seed:demo` (the fixture the E2E and a manual demo both open)

```
{"dataDir":"…\\CompIntel-dev\\e2e\\demo-wp16b","events":120,"visible":114,
 "classified":121,"sourcesSwitchedOff":8,"conflictEventId":"01a0c619-58b7-7000-a03c-45f54c4b5fad"}
```

`sourcesSwitchedOff` is 8, not 7: the fixture's `hackxyz-site` source is added **before** the
switch-off, so the seeded database still registers no scrape job and contacts nothing.

## 2. What shipped

| Area | Files |
|---|---|
| Contracts | `event-detail.ts` (`SelectionReason`, `FieldClaim`, `ClaimGroup`, `DetailConflict`, `EventSourceDetail`, `EventCategoryDetail`, `EventDetailView`, `EventCategoriesInput/Result`, `OVERRIDE_FIELD_LABELS`, `CHANGE_CAUSE_LABELS`, `selectionReasonText`); `source-status.ts` (split out of `sources.ts`: `SourceHealth`, `SourceStatusEntry`, `SourceStatusResponse`, `sourceHealthOf`, §7.7's `sourceStatusMessage`); `dedup.ts` `EventChangeDto` gains `fieldLabel`/`causeLabel` |
| Backend | `domain/events/resolve.ts` → `selectionReasonOf` (pure); `modules/events/{detail.ts,detail-repo.ts,categories.ts}`; `routes/event-detail.ts`; `modules/sources/{service.ts,mappers.ts}` → `statusView(actor)` + `toStatusEntry`; `review.ts` renders change labels |
| Fixtures | `apps/backend/test/fixtures/conflicts/three-sources-disagree.json`; `testing/conflicts.ts` + `testing/index.ts` (new `@compintel/backend/testing` entry point); `testing/events.ts` gains prize fields and a folder argument |
| Desktop | `api/event-detail.ts`; `features/discover/detail/` (`EventDrawer`, `ConflictPanel`, `FactsGrid`, `Provenance`, `DeadlineTimeline`, `SourcesList`, `ChangeHistory`, `CategoryChips`, `values.ts`, `use-event-detail.ts`); `features/freshness/` (`FreshnessPill`, `use-source-status.ts`, `source-health.ts`); `lib/{ago.ts,external.ts}`; `TopBar` gets the real pill; `styles/app.css` `.ci-drawer` |
| Tests | 7 new files, **3030 → 3113 tests**, 126 s |
| E2E | `discover.spec.ts` gains "the conflict fixture opens a drawer that says Sources disagree"; `seed:demo` loads the fixture |

### The manual run (and the three bugs it found)

Four screenshots under `%LOCALAPPDATA%\CompIntel-dev\e2e\wp16b-*.png` (not committed), taken against
the seeded database through the real backend: the drawer with the conflict panel; its lower half with
the deadlines, the sources and their attribution and the change history; the facts grid with a
provenance disclosure open; and the freshness popover. **Looking at it caught three things the tests
did not**, all now fixed with a regression test each:

1. **Two rows marked "selected"** in "Smallest team": the site and Devfolio both claim 2 and CTFtime
   claims 3, and the panel marked by *value*. `DetailConflict` now carries `selectedSourceRecordId`
   and exactly one claim is marked.
2. The popover listed **"Typed in by hand" and "Imported from a link"** as sources that were "paused by
   policy". They are people, not scrapers; `SourceStatusEntry` gained `adapter` and the §16.1 popover
   filters them out. The API still reports them, for WP-30's admin screen.
3. A paused source promised a **"Next run: 1 day ago"**. A source nobody is asking has no next run, so
   the line is gone for `PAUSED_BY_POLICY`.

## 3. Deviations from the prompt

1. **"Load older" reuses `GET /events/:id/changes`** (WP-10's route) rather than a second history
   endpoint. `EventChangeDto` gained `fieldLabel`/`causeLabel` so the embedded first page and the
   paged one are one shape; the alternative was two routes returning the same rows worded differently.
2. **A prize disagreement is shown but is not *material*.** §7.5's material list is dates > 1 h,
   team size, fee and mode — prize is not on it, and `resolve.ts` is WP-10's ruling, not this WP's to
   change. So the fixture's three disagreements are two material ones and one wording one, and the
   panel lists the wording ones under "Minor differences" inside the same panel. Every claimed value
   is still shown with its source, which is what §19 asks for.
3. **The freshness pill polls every 60 s; it does not ride the SSE stream.** Step 6 asked which and
   why: **nothing publishes scrape events.** `StreamHub.publish` has no caller in `main.ts`,
   `scraping/` or any module, so a stream-driven pill would sit at "Updated 4 min ago" for an hour —
   wrong in the one way a freshness indicator must never be. One small local query every minute is
   honest and cheap. `SOURCE_STATUS_KEY` is what WP-30 should invalidate when it starts publishing.
4. **"Open registration" hands the URL to `window.open(_blank)` after an http/https check**, and says
   so with a toast (and the URL to copy) if the environment refuses. §13's "URLs open in the default
   browser" needs a Rust command (`tauri-plugin-opener` or three lines in `commands.rs`), and R29/R19
   put `src-tauri` outside this WP. The app never navigates away from itself either way. See Q2.
5. **`packages/contracts/src/sources.ts` was split.** Adding the status shapes took it to 444 lines
   against the 400 limit; `source-status.ts` now holds the health enum, the status DTOs and §7.7's
   sentence table, with `source-status.test.ts` beside it.
6. **A new package entry point, `@compintel/backend/testing`**, so `pnpm seed:demo` can load the
   conflict fixture through the real linker instead of writing claim rows by hand. It exports one
   function (`seedScenario`) and the main entry point does not re-export it.

## 4. Minor decisions

1. **The selection reason is read off the field's *group*.** WP-10 resolves by field group, so
   "why did this win" must be answered over the same pool or the drawer explains a decision nobody
   took. `ONLY_SOURCE` is the fourth reason: with one claim there is no contest, and "highest trust
   rank" would be true and misleading.
2. **Provenance is a disclosure, not a `title=` tooltip.** §16.3 wants a full keyboard path and a
   `title` has none. The same panel opens for a mouse and a keyboard, and it lists *every* source that
   stated the field — useful even where nothing disagrees.
3. `PUT /events/:id/categories` takes **the whole intended set**, not a delta: the chips are a set,
   and a delta makes two people each sending "add this one" ambiguous. Adding back a suppressed
   category clears the suppression. A body that changes nothing is a no-op: no audit row, no version bump.
4. The drawer's **facts grid labels come from the contracts' total `Record<OverrideField, string>`**,
   so a new overridable field without a label is a type error rather than `registrationDeadlineAt`
   on a professor's screen.
5. `SourceStatusResponse` carries `offline: true` only when **every** enabled source that has run was
   skipped offline. One source failing is a row in the popover, not a banner over the app (D-23/§7.7).
6. `lib/ago.ts` is the compact relative form ("4 min ago", "2 h ago"); `lib/time.ts`'s long form stays
   for diagnostics. Both take `now` from the caller, so nothing reads the clock during a render.
7. `testing/clock.ts` exists because `fake-search.ts` and `event-detail.ts` both need `NOW` and one
   imports the other — a constant in either was `undefined` in whichever module loaded second, and the
   symptom was a date silently becoming `null` over JSON.
8. The conflict fixture's title is "HackXYZ 2026 AI Hackathon" so WP-15b's starter rules give it a
   category, which is what makes the override chips demonstrable on the seeded database.

## 5. Known issues / tech debt

- **`pnpm verify` is ~124 s** against §4.15's < 2 min. The Discover axe test now needs a 45 s
  per-test timeout (four axe passes over 30 cards in jsdom, plus the top bar's new status query).
  This is the third WP in a row where the budget has tightened; it wants attention before M2.
- **No default-browser hand-off** (deviation 4). On the packaged app `window.open` may be refused,
  in which case the button shows the URL to copy rather than opening it.
- The R27 proxy is still GET-only, so the category override — a PUT — cannot work on a machine that
  needs the F9 fallback. Same pre-existing gap WP-16a reported for Save/Hide.
- WP-15b's perf question (Q1 there) still stands; `detail by id` was 0.65 ms p95 and the new
  detail route adds four small reads on top.
- **The deadlines timeline shows one row per source record**, so the fixture's three sources produce
  three "Registration closes" rows with different times. That is honest — each is a source's own
  statement, and the conflict panel explains the disagreement — but it reads as repetition. Grouping by
  kind + label with the disagreement folded into the conflict panel would be better, and is a small
  follow-up rather than a WP-16b change.
- The drawer shows `descriptionMd` as plain text. It is sanitized at the adapter boundary (§7.3), but
  it is Markdown and is rendered as if it were not — a renderer belongs with WP-33's appearance work.

## 6. Questions for the architect

1. **Is a prize disagreement material?** (deviation 2) §7.5 lists dates/team/fee/mode. Three sources
   claiming ₹2,00,000, ₹1,50,000 and $2,000 is arguably as decision-changing as a team size. If it
   should be, it is one line in `resolve.ts`'s `MATERIAL_FIELDS` — but that is WP-10's ruling.
2. **§13's "URLs open in the default browser" needs one Rust command.** Add `tauri-plugin-opener`
   (or a three-line `open_external` in `commands.rs`) in WP-30, which is already touching the shell,
   or should it come sooner?
3. **Should anything publish scrape events on the SSE hub?** (deviation 3) `StreamHub.publish` has
   no caller anywhere. WP-30's health surface is the natural owner; until then every freshness
   surface has to poll.

## 7. Files the architect should review

1. `packages/contracts/src/event-detail.ts`
2. `apps/backend/src/modules/events/detail.ts`
3. `apps/backend/src/domain/events/resolve.ts` (`selectionReasonOf`)
4. `apps/desktop/src/features/discover/detail/ConflictPanel.tsx`
5. `apps/desktop/src/features/freshness/use-source-status.ts`

## 8. Demo script for the product owner (M1 closes here)

Launch CompIntel and sign in. The left rail opens on **Discover**, already showing ranked events with
a real distance from the campus and a countdown on every card. In the chips bar choose **Hackathon**,
**Within 250 km (in person)** and **Closing in 7 days** — the count above the list updates, and the
chips read back in words, not codes. Type *hackthon* in the top-bar search and press Enter: the line
under the count says "Showing results for hackathon (searched hackthon)", so the correction is
reported rather than done silently. Press **J** twice and **Enter** to open an event: the drawer
slides in over the list, which keeps its place. At the top of it sits **Sources disagree** — three
sources, three different registration deadlines, three different prizes, each with the source that
stated it and when it was seen, and the value CompIntel shows ticked with the reason it won ("the most
trusted source stating it"). Nothing was averaged. Below, every fact carries *as stated by
hackxyz-site, verified 2 h ago*; the deadlines run down a timeline, a day-only date reading "by 7 Oct"
rather than inventing midnight; the sources are listed with their attribution; and the change history
says, in words, what moved and why. Press **S** to save it, then **Esc** — the list is exactly where
it was, with the same card focused. Finally, click **Updated 4 min ago** in the top bar: a popover
names every source, its state as an icon and a label, when it last succeeded and when it runs next —
and, for anything failing, the sentence explaining what happened and what to do about it.
