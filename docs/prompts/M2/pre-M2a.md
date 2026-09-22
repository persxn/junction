pre-M2a — UI & shell fault fix pass: writes through the fallback, links that open, one-button sign-in, sealed sessions, live freshness, verify under two minutes

Fresh session. Read ONLY: docs/PROGRESS.md · docs/handoff/M1-review.md (§3 is this WP's fault list) ·
docs/handoff/WP-14.md, WP-16a.md, WP-16b.md (their "Known issues" sections) · docs/handoff/WP-05b.md ·
docs/ARCHITECTURE.md §3.2, §13, §16.1, §21 (**R27, R30, R36, R74, R75, R76, R78, R86, R89** bind) ·
apps/desktop/src-tauri/src/** · apps/desktop/src/{api,shell,app,components,features}/** ·
apps/backend/src/{platform,scraping,modules/sources}/** · packages/contracts/src/*.ts ·
vitest.config.ts · package.json manifests.

Why: M1 shipped screens that work on this machine and fail on a real one. Under enforced Local Network
Access every write — Save, Hide, category override, POST search — silently fails because R27's proxy is
GET-only; "Open registration" may do nothing in the packaged app; the sign-in window cannot say it is
done; the freshness pill polls because nothing publishes. M2 adds a dozen forms on top of this, so it
is fixed first. **No rulings to write** — R75–R90 are already in §21 (v1.1.14).

BUILD — one commit per item, `pnpm verify` green after each:
1. **Writes through the fallback (R78).** Rust `backend_request {method, path, headers, body}` replaces
   the GET-only `backend_get`: GET/POST/PUT/PATCH/DELETE; path must start `/api/v1/` and must not be
   `/api/v1/system/*` or `/api/v1/stream`; `Content-Type: application/json` only; body ≤ 1 MB; forwards
   `Authorization` and the client secret; follows no redirects; returns status, headers and body
   verbatim. The UI's API client routes **every** method through it when the F9 fallback is active.
2. **Links open (R78, §13).** Rust `open_external(url)` — http, https, mailto only, anything else
   refused — replaces `window.open` in the drawer's "Open registration", source links and every
   external link in the app. A refused URL shows the URL to copy, as today.
3. **Sign-in window reports back.** The packaged sign-in window emits a `signin://finished {sourceKey}`
   event when the user closes it or reaches the source's signed-in landing page; `SessionCard` becomes
   one button ("Sign in to Devfolio"), and the captured session is verified and stored on that event.
4. **Sessions sealed at rest (R76).** On first run the shell creates a 32-byte data key, stores it
   DPAPI-protected (CurrentUser) at `<dataDir>\session-key.bin`, and passes it to each backend spawn as
   `COMPINTEL_SESSION_KEY` beside the client secret. The backend seals session cookies with AES-256-GCM
   (Node `crypto`, no new dependency) and migrates any existing plaintext session setting on startup. No
   key → sessions report "unavailable on this machine" and the source reads public pages. Sealed values
   never appear in exports, diagnostics or responses.
5. **Connect your sources (R74 product flow, R75 limits).** A one-time screen right after the setup
   wizard finishes — **not** inside the R40 transaction — listing each approved source that supports
   sign-in, with its one-button sign-in (item 3), a plain sentence on what the session is used for (the
   professor's own registrations and pages the public site does not show; listings stay anonymous —
   R75), and "Skip for now". Reopenable from Admin → Sources. Shown once; the flag lives in `settings`.
6. **Live freshness (R86).** The scrape orchestrator publishes `source.run.finished {sourceKey,
   outcome, finishedAt}` on the SSE hub; the freshness pill invalidates `SOURCE_STATUS_KEY` on it and
   keeps a 5-minute poll as its R30 fallback (was 60 s).
7. **Small UI faults:** the rail's "CompIntel" brand moves inside a landmark, and every axe test drops
   its container scoping so the whole document is checked · a manual event's reserved
   `manual.compintel.invalid` URL is never rendered — the drawer says "Entered by hand" · the
   sanitizer renders `mailto:` links as the address text only (WP-13 Q2), never a clickable link to a
   scraped address · routes are lazy-loaded so no chunk exceeds 500 kB (report sizes before/after).
8. **Verify under two minutes (R89).** Move the multi-pass jsdom axe integration suites into a new
   `pnpm test:a11y` (Vitest project `a11y`); single-component axe assertions stay in verify. Fix the
   `routes.test.ts` 1 MB body-limit test that times out one run in three (build the body once, use a
   local socket, no 20 s timeout). No test in verify may need a timeout above 20 s.

TESTS:
- Rust: `backend_request` refuses a non-`/api/v1/` path, `/api/v1/system/shutdown`, `/api/v1/stream`, a
  2 MB body, a non-JSON content type and a redirect; forwards all five methods · `open_external` refuses
  `file:`, `javascript:`, `ms-settings:`, a UNC path and an `http` URL with embedded credentials · the
  session key round-trips through DPAPI and a key file from another user fails cleanly.
- UI under a simulated fallback: Save, Hide + Undo, a category override and a search all succeed.
- Backend: a sealed cookie is unreadable without the key; with no key the source reads public pages and
  says why; the plaintext-to-sealed migration runs once and is idempotent.
- The connect step appears once after setup, Skip hides it for good, and it never blocks sign-in.
- The pill updates within one SSE event of a finished run, and falls back to polling when SSE is down.

ACCEPTANCE: `pnpm verify` green **and under 120 s** (state the time) · `pnpm test:a11y` green with axe on the
whole document · `pnpm e2e` green · the three Rust checks run and reported (R19) · the built exe, launched
with the LNA flags from PROGRESS.md, performs Save, Hide and a category override and opens a link in the
default browser (say how you checked) · no new dependency · files < 400 lines.

OUT OF SCOPE: ingestion and search corrections (pre-M2b) · R75's request budget inside the scraper
(pre-M2b) · WP-30's health badge and source table · anything in M2.

Finish per CLAUDE.md (verify, PROGRESS.md ≤ 10 lines and < 150 total, docs/handoff/pre-M2a.md, commit
"pre-M2a: UI and shell fault fixes", print the report). List every fault fixed, and any **new** fault the
sweep found that you did not fix.
