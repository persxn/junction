pre-M2a — UI & shell fault fix pass: writes through the fallback, links that open, one-button sign-in, sealed sessions, live freshness, verify under two minutes

**RESUMED WORK.** Items 1–4 are built and committed. Items 5–8 are untouched. A previous
session ran out of budget mid-package; §A below is what it did, §B is what is left, and the
BUILD list keeps its original numbering so nothing is renumbered under you. Read §A first —
several of its decisions change how you should write items 5–8.

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

---

## §A — What is already done (items 1–4)

Three commits on `main`, newest last:

| Commit | Items | What landed |
|---|---|---|
| `14e2486` | 1, 2 | `backend_request` + `open_external` |
| `51ce844` | 3 | `signin://finished`, one-button `SessionCard` |
| `a89ad9b` | 4 | AES-256-GCM sealed sessions under a DPAPI-held data key |

There is also `8770e95`, which is only the architect's own `docs/` drop (spec v1.1.14, the M1 review,
the M2/M3 prompts) committed on its own so it is separable from the work. **`docs/prompts/M4/*` is
untracked and is not this WP's** — leave it alone.

### Item 1 — Writes through the fallback (R78) ✅

`apps/desktop/src-tauri/src/loopback.rs` is rewritten. `backend_get` is **gone**; `backend_request`
replaces it and takes one `ProxyRequest {method, path, headers, body}` argument (note: the IPC
argument is named `request`, so the page invokes `invoke('backend_request', { request: {...} })`).

- `loopback::authorise()` holds every R78 rule and is where you add anything: the five methods, the
  `/api/v1/` prefix minus `/api/v1/system/*` and `/api/v1/stream` (query strings stripped before the
  comparison), JSON bodies only, the 1 MB cap, and `FORWARDABLE_HEADERS` = Authorization,
  Content-Type, Accept. **An unlisted header is refused, not dropped** — that was a minor decision,
  on the grounds that a silently ignored header makes the shell send a request nobody asked for.
- `LoopbackResponse` now carries `headers: Vec<(String, String)>` as well as status and body, so the
  API client reads a problem document off the fallback exactly as it does off `fetch`. The contract
  (`packages/contracts/src/shell.ts`) gained `LoopbackRequest` and the `headers` tuple array.
- No redirect is ever followed; a 3xx is returned verbatim, with a test that proves one request was
  made.
- `apps/desktop/src/api/client.ts`'s `viaShell` routes **every** method. The old "This action is not
  available on this machine" `ApiProblem` is deleted, and its test is replaced by one that proves a
  POST succeeds over the fallback.

### Item 2 — Links open (R78, §13) ✅

New `apps/desktop/src-tauri/src/external.rs`, command `open_external(url)`. http, https and mailto
only; a web URL carrying credentials (`http://user:pass@host/`) is refused; `file:`, `javascript:`,
`ms-settings:`, a UNC path and an unparseable string are refused. It launches through `ShellExecuteW`
from the `windows` crate the Job Object already uses — **no new dependency**; `Win32_UI_Shell` and
`Win32_UI_WindowsAndMessaging` were added to that crate's existing feature list.

`apps/desktop/src/lib/external.ts`'s `openExternal` is now **`async` and returns
`Promise<boolean>`** — every call site must `void openExternal(url).then(...)`. Only `EventDrawer.tsx`
called it; it was updated. `window.open` no longer appears anywhere in `apps/desktop/src`.

### Item 3 — Sign-in window reports back ✅

`signin.rs` emits `signin://finished {sourceKey}` exactly once per window, guarded by an `AtomicBool`,
from whichever happens first:

- **navigation past the login form** — `is_landing()` treats "an allowed host, on a path that is not
  the login URL's path" as success. **Minor decision:** there is no configured landing URL and none
  was invented, because a per-source "you are in now" URL is a setting that goes stale the next time
  the site reorganizes itself. A form posting to itself, a `?next=` round trip and an error reload all
  stay on the login path and are correctly not treated as success.
- **the window being destroyed** — the professor gave up. The UI still captures; an empty capture is
  how "not signed in" is said, and it produces an info toast, not an error.

`SessionCard.tsx` is now presentation only; the flow lives in the new
`apps/desktop/src/features/admin/sources/use-source-session.ts`. "Use this session" is gone.

### Item 4 — Sessions sealed at rest (R76) ✅

- `apps/desktop/src-tauri/src/session_key.rs`: 32 bytes on first run, `CryptProtectData`
  (CurrentUser, `CRYPTPROTECT_UI_FORBIDDEN`) → `<dataDir>\session-key.bin`, read back on every later
  run. A key file this account did not write fails cleanly **and is left on disk** — replacing it
  would throw away the only thing that can open the sessions already stored. Wired in `lib.rs` by
  pushing `COMPINTEL_SESSION_KEY` onto `SupervisorConfig::extra_env`, which every spawn already
  applies, so `supervisor.rs` was not touched.
- `apps/backend/src/modules/sources/seal.ts`: AES-256-GCM over `node:crypto`, **no new dependency**.
  Sealed form is `ci1.<base64url(iv | tag | ciphertext)>`, versioned so a future change is a migration.
- `session.ts` now takes a **`SessionVault {settings, key}`** instead of a bare `SettingsStore`
  wherever the cookie's value is involved. `openSession`, `sealStoredSessions` and `assertCanSeal`
  are new. `createSessionHooks` in `scraping/sessions.ts` takes the vault too.
- `modules/sources/vault.ts` is new: `openSessionVault()` (called once from `main.ts`, does the
  plaintext→sealed migration and logs a **count, never a value**) and `sourceCredentials()`. Both
  were extracted to keep `main.ts` and `service.ts` under the 400-line lint cap — **they are at 400
  and 401 respectively, so anything you add to either must be extracted, not appended.**
- Contract: `SOURCE_SESSION_STATES` gained **`UNAVAILABLE`** — stored, sealed, and this machine holds
  no key that opens it. `SessionCard` renders it in the warning tone with
  `unavailableDetail()`'s sentence.
- **A value that is not sealed is never used**, even when it is readable plaintext and there is no
  key. Without a key the source reads public pages, and `PUT .../session` is refused with a 409 that
  tells the professor to start CompIntel from its own shortcut rather than writing a live session in
  the clear.
- Test seam: `apps/backend/src/testing/session-key.ts` exports `TEST_SESSION_KEY_HEX`; the Devfolio
  harness exposes `harness.vault`, and `setup-server.ts` passes `sessionKey` so the route tests
  behave like the app rather than like a keyless backend.

### State of the checks when work stopped

- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`: **green** at `a89ad9b`.
- `pnpm test`: **green — 3137 tests in 112.9 s.** The run before it failed one test, and that is worth
  knowing: it is item 8's own flake, the `routes.test.ts` 1 MB body-limit test that "times out one run
  in three". It passes alone every time and passed on the re-run. Do not go hunting for a regression
  when you meet it — fix it as item 8 says.
- Verify as a whole is still over budget (~126 s at M1, and `pnpm test` alone is 113 s of that). Item 8
  is what brings it under 120 s, so do not expect an honest acceptance number until it is done.
- Rust: `cargo test` 72 passed, `cargo clippy -D warnings` clean, `cargo fmt` applied.
- `pnpm e2e` has **not** been run since M1.
- No packaged-exe run has been done yet — that acceptance line is entirely owed.

### Two traps that cost the last session time

- **Write files with LF.** Python's `write_text` emits CRLF on Windows and `.gitattributes` enforces
  LF; pass `newline='\n'`. Prettier rewrites `.ts`, but `.rs` files keep whatever you wrote.
- A `bash` heredoc containing this repository's prose (typographic quotes, `'`) failed to parse twice.
  Write a script to the scratchpad and run it, or use the Write tool.

---

## §B — What is left (items 5–8)

Original numbering kept. Everything below is unstarted.

5. **Connect your sources (R74 product flow, R75 limits).** A one-time screen right after the setup
   wizard finishes — **not** inside the R40 transaction — listing each approved source that supports
   sign-in, with its one-button sign-in (item 3 — reuse `useSourceSession`, do not reimplement it), a
   plain sentence on what the session is used for (the professor's own registrations and pages the
   public site does not show; listings stay anonymous — R75), and "Skip for now". Reopenable from
   Admin → Sources. Shown once; the flag lives in `settings`. `SetupGate` in
   `apps/desktop/src/app/App.tsx` is the gate it sits behind, between the wizard and `SessionGate`.
6. **Live freshness (R86).** The scrape orchestrator publishes `source.run.finished {sourceKey,
   outcome, finishedAt}` on the SSE hub; the freshness pill invalidates `SOURCE_STATUS_KEY` on it and
   keeps a 5-minute poll as its R30 fallback (was 60 s). `finish()` in `apps/backend/src/scraping/run.ts`
   is the one place every run ends; `StreamHub.publish` in `platform/stream.ts` still has no caller,
   and `STREAM_EVENT_TYPES` in `packages/contracts/src/auth.ts` needs the new type. The consumer is
   `use-live-updates.ts` plus `features/freshness/use-source-status.ts`, whose doc comment currently
   explains why it polls — rewrite it, do not leave it lying.
7. **Small UI faults:** the rail's "CompIntel" brand moves inside a landmark (`app/NavRail.tsx`), and
   every axe test drops its container scoping so the whole document is checked · a manual event's
   reserved `manual.compintel.invalid` URL (`MANUAL_URL_PREFIX`, `backend/src/domain/import/candidate.ts`)
   is never rendered — the drawer says "Entered by hand" · the sanitizer
   (`backend/src/domain/normalize/text.ts`, which allows the `mailto` scheme today) renders `mailto:`
   links as the address text only (WP-13 Q2), never a clickable link to a scraped address · routes are
   lazy-loaded so no chunk exceeds 500 kB (report sizes before/after; `app/router.tsx` writes each
   route out longhand on purpose — keep that and lazy-load the components).
8. **Verify under two minutes (R89).** Move the multi-pass jsdom axe integration suites into a new
   `pnpm test:a11y` (Vitest project `a11y`); single-component axe assertions stay in verify. Fix the
   `routes.test.ts` 1 MB body-limit test that times out one run in three (build the body once, use a
   local socket, no 20 s timeout). No test in verify may need a timeout above 20 s.
   Note: `rawRequestWithBody` in `backend/src/testing/harness.ts` **already** uses `node:http`. The
   remaining hang is that its promise never settles when the write side errors before the response
   callback fires — both paths swallow ECONNRESET/EPIPE and neither resolves. Fastify answers 413 off
   the `Content-Length` header alone, so settling on the first of response-or-error is the fix.

## TESTS still owed

- Rust: ✅ done for items 1–4 (`backend_request` refusals and all five methods; `open_external`'s five
  refusals; the session key's DPAPI round trip and a foreign key file). Nothing new is owed unless
  items 5–8 touch `src-tauri`.
- ✅ UI under a simulated fallback: Save, Hide + Undo, a category override and a search all succeed —
  **partly done.** `client.test.ts` proves all five methods go through with their bodies; the
  *screen-level* Save/Hide/override/search assertions are still owed.
- ✅ Backend: a sealed cookie is unreadable without the key; with no key the source reads public pages
  and says why; the plaintext-to-sealed migration runs once and is idempotent. Done in
  `seal.test.ts` and `session.test.ts`.
- The connect step appears once after setup, Skip hides it for good, and it never blocks sign-in.
- The pill updates within one SSE event of a finished run, and falls back to polling when SSE is down.

## ACCEPTANCE (unchanged)

`pnpm verify` green **and under 120 s** (state the time) · `pnpm test:a11y` green with axe on the
whole document · `pnpm e2e` green · the three Rust checks run and reported (R19) · the built exe, launched
with the LNA flags from PROGRESS.md, performs Save, Hide and a category override and opens a link in the
default browser (say how you checked) · no new dependency · files < 400 lines.

OUT OF SCOPE: ingestion and search corrections (pre-M2b) · R75's request budget inside the scraper
(pre-M2b) · WP-30's health badge and source table · anything in M2.

Finish per CLAUDE.md (verify, PROGRESS.md ≤ 10 lines and < 150 total, docs/handoff/pre-M2a.md, commit
"pre-M2a: <summary>", print the report). List every fault fixed, and any **new** fault the
sweep found that you did not fix. The report must cover items 1–8, not only the ones you built —
§A above is the material for 1–4.

## Questions §A left for the architect

1. `is_landing()` calls "an allowed host on a path that is not the login path" a completed sign-in.
   Is that good enough, or should `config_json.session` carry a landing pattern per source?
2. R78's proxy **refuses** a request header it does not forward rather than dropping it. Refusing
   makes the shell's surface explicit; dropping would be more forgiving to a future caller. Confirm?
3. A plaintext session on a machine with no key is left on disk and never used, so it is dead weight
   until the professor signs in again. Should it be cleared instead, or is leaving it right?
