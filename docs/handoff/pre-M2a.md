# pre-M2a — UI & shell fault fix pass

Status: **PARTIAL** — items 1–8 are built and every owed test is written; two acceptance lines are not
met: `pnpm verify` is **134 s** against the 120 s target (R89), and the built exe has not been
click-tested (it needs a person at the keyboard). Everything else is green.

Items 1–4 landed in a previous session (`14e2486`, `51ce844`, `a89ad9b`); §1 below records them as the
prompt asks, and §2 is this session's work.

## 1. Items 1–4, as built (from the prompt's §A)

1. **Writes through the fallback (R78).** `backend_request` replaced `backend_get`; `loopback::authorise()`
   holds every rule (five methods, `/api/v1/` minus `system/*` and `stream`, JSON bodies, 1 MB cap,
   three forwardable headers — an unlisted header is **refused**, not dropped). `LoopbackResponse`
   carries headers, no redirect is followed, and `client.ts`'s `viaShell` routes every method.
2. **Links open (R78, §13).** `external.rs` + `open_external(url)`: http/https/mailto only, credentials
   in a web URL refused, `ShellExecuteW` through the `windows` crate already present — no new dependency.
   `openExternal` is now async and `window.open` appears nowhere in `apps/desktop/src`.
3. **The sign-in window reports back.** `signin://finished` once per window, from navigation past the
   login form or from the window being destroyed; `SessionCard` is presentation, the flow is
   `use-source-session.ts`, and there is one button.
4. **Sessions sealed at rest (R76).** `session_key.rs` (DPAPI, CurrentUser) → `COMPINTEL_SESSION_KEY`;
   `seal.ts` AES-256-GCM `ci1.<base64url(iv|tag|ciphertext)>`; `SessionVault`; `vault.ts`'s
   plaintext→sealed migration logs a count, never a value; `UNAVAILABLE` is a source state; a value that
   is not sealed is never used, and `PUT .../session` is refused with a 409 when there is no key.

## 2. Items 5–8, this session

5. **Connect your sources (R74's product flow, R75's limits).** New `sources.connectPromptSeenAt`
   setting; `ConnectPromptService` (read open to any session, `markSeen` needs `source.manage`, audited
   once); `GET /sources/connect-prompt` and `POST /admin/sources/connect-prompt/seen`;
   `ConnectSourcesScreen` renders one `SessionCard` per source that may hold a session and says in words
   what the session is used for and that the scheduled walks stay anonymous; `ConnectSourcesGate` shows
   it once; `/admin/sources/connect` reopens it and Admin → Sources links to it. **It sits below
   sign-in, not above it** — see §4.
6. **Live freshness (R86).** `STREAM_EVENT_TYPES` gained `source.run.finished`; `finish()` and
   `closeImmediately()` both announce through a `onRunFinished` callback (a skipped run still moves
   `last_run_at`, so the pill has to hear about it); `main.ts` owns the one `StreamHub` and passes it to
   both `buildApp` and the scrape runtime; `use-live-updates.ts` invalidates `SOURCE_STATUS_KEY` on the
   event and the poll fell from 60 s to 5 minutes as R30's fallback.
7. **Small UI faults.** The rail's brand and collapse control moved inside the `nav` landmark and every
   axe assertion now checks `document.body` unscoped · `MANUAL_URL_PREFIX` moved to the contracts and
   `EventSourceDetail.url` is nullable, so `detail-repo.ts` drops a manual entry's `.invalid` URL at the
   API boundary and `SourcesList` says "Entered by hand" · a scraped `mailto:` becomes the address as
   text through a Turndown rule (the `sanitize-html` `transformTags` route silently dropped the rest of
   the sentence after the link) · every route component is `lazyRouteComponent`, which took the single
   **683 kB** chunk down to a largest of **428 kB** (gzip 137 kB) with no warning.
8. **Verify (R89).** New `a11y` vitest project over `*.a11y.test.tsx` (`pnpm test:a11y`, 23 tests, 9 s);
   `pnpm test` is now `--project node --project desktop`. The `routes.test.ts` 1 MB flake is fixed by
   flushing the headers and sending the body only if the server has not answered on `Content-Length`
   alone — the promise now settles on the first of response-or-error and the file runs in 1.5 s. No test
   in verify asks for more than 20 s: the process suites' 60 s went away with the two real findings
   behind it (eighteen serial spawns in one file, and sixteen workers on an eight-core box).

## 3. What each measurement says

| Check | Result |
|---|---|
| `pnpm verify` | **green, 134 s** (target < 120 s — not met) · `pnpm test` 101 s of it, 3 137 tests |
| `pnpm test:a11y` | green, 23 tests, 9 s, axe over the whole `document.body` |
| `pnpm e2e` | green, 2 tests, 12 s — and it now walks through the connect step in a real browser |
| `cargo fmt --check` | clean |
| `cargo clippy --all-targets -D warnings` | clean **after fixing a fault it was already failing on** (§5) |
| `cargo test` | 79 passed (72 + 7) |
| Built exe with the LNA flags | **not done** — see §4 |

Where verify's 134 s goes: `format:check` 7 s · `lint` 26 s · `typecheck` ~1 s warm · `test` 101 s. The
test half came down from 113 s by three things: the desktop project 50 s → 19 s (lazy routes moved most
of the module graph off the critical path, and the axe passes left), `main.test.ts` 42 s → 19 s split in
three, and `admin-users.test.ts` 68 s → 19 s split in three. What is left is **CPU, not serialisation**:
the suite spends ~160 s of its ~494 s of thread time inside Argon2id at 128 MiB (R17) across six files,
and under that load a single hash measures 2.4 s instead of 322 ms. See the question in §6.

## 4. Deviations from the prompt

1. **The connect step sits below sign-in, not between the wizard and `SessionGate`.** It has to store a
   session, and `PUT /admin/sources/:key/session` needs an authenticated administrator (§10.2
   `source.manage`); the wizard signs nobody in — `SetupResult` carries a recovery code, not a token. A
   screen where the prompt asked for one would show sign-in buttons and then fail every one of them with
   a 401. It is now above the router and below the session, which keeps everything the prompt wanted:
   once per installation, right after the wizard, outside R40's transaction, never blocking sign-in
   (asserted). Reopening it is a route rather than a gate flag, so it does not unmount the router and
   throw away the screen the professor was on.
2. **`pnpm test` runs two projects by name** rather than everything, so `pnpm verify` does not pay for
   the axe suites. A bare `vitest run` still runs all three.
3. **`vitest.config.ts` caps `maxWorkers` at 8.** Measured on this box: 118 s at the default (15), 100 s
   at 8, 104 s at 6, and 96 s at 12 — but at 12 a spawn was starved past its 20 s ceiling, which R89
   calls a finding rather than a timeout to raise. Eight is the fastest setting that never starves one.
4. **Four axe assertions stayed in verify** (`CreateEventPage`, `SourcesPage`): they are single passes
   inside behaviour tests about something else, which is R89's "single-component axe assertions stay in
   verify" rather than a multi-pass integration suite. Total cost ~1.2 s.

## 5. New faults the sweep found

1. **Two routed screens rendered a second `<main>`** inside `AppShell`'s (`SourcesPage`,
   `CreateEventPage`) — a duplicate landmark that the container-scoped axe tests could not see. Both are
   named `section`s now. **Fixed.**
2. **The three credential screens rendered every word outside any landmark** (login, lock, change
   password). `CredentialScreen` renders a `main`. **Fixed.**
3. **`cargo clippy --all-targets -D warnings` was failing** on `session_key.rs:173`: a literal tab inside
   a doc comment, where `\test-tmp` had been written by a script that turned `\t` into a tab. Item 4's
   report said clippy was clean, so it was probably run before that edit. **Fixed** — and worth knowing:
   writing Rust or Markdown through a shell heredoc in this environment can turn `\t`, `\n` and friends
   into the characters they name.
4. **`LoopbackRequest.body` is `z.string().optional()` while `backendRequest` sends `null`** for a
   request without one (Rust reads `Option<String>`). Nothing parses that schema at runtime, so the two
   have never disagreed out loud; the new test helper had to read it as nullable. **Not fixed** —
   a contract change, and the architect should say whether `nullish()` or a `null`-free payload is wanted.
5. **The e2e smoke would have blocked on the connect step** — it signs in as an administrator on a fresh
   installation. It now walks through it, which is real-browser evidence for item 5. **Fixed.**

## 6. Questions for the architect

1. **Argon2id inside the test suite.** Six files hash at R17's production cost, which is ~160 s of the
   suite's thread time and the only thing now standing between `pnpm verify` and 120 s. May the *tests*
   hash at a cheap cost (e.g. m=19 MiB, t=2 — §4.12's floor), with `password.test.ts` keeping the
   measured production parameters, or does every route test have to prove login at the real cost?
   Expected saving: ~40–60 s off verify.
2. **`is_landing()`** (from item 3, still open) calls "an allowed host on a path that is not the login
   path" a completed sign-in. Good enough, or should `config_json.session` carry a landing pattern?
3. **R78's proxy refuses an unlisted request header** rather than dropping it. Confirm?
4. **A plaintext session on a machine with no key** is left on disk and never used. Clear it instead?
5. **`LoopbackRequest.body`** — §5.4 above.

## 7. Known issues / tech debt

- `pnpm verify` 134 s (see §3 and question 1). `pnpm test` alone is 101 s.
- The built exe has not been launched with the LNA flags, so **Save / Hide / a category override /
  opening a link in the default browser are unproven in the packaged app**. What is proven without it:
  `loopback.rs`'s refusals and all five methods (Rust), `client.test.ts`'s five methods with their
  bodies, and the new `features/discover/fallback.test.tsx` — Save, Hide + Undo, a category override and
  a search, driven through real screens with the shell proxy as the only transport. The manual step is
  `pnpm --filter @compintel/backend bundle && pnpm --filter @compintel/desktop tauri:build`, then launch
  the exe with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--enable-features=LocalNetworkAccessChecks,msWebViewAllowLocalNetworkAccessChecks`.
- `docs/research/webview2-local-network-access.md`'s re-check is still owed after any WebView2 update.
- The `a11y` project shares `testing/setup.ts` with `desktop`, so the two cannot drift apart; four axe
  assertions remain in verify by design (§4.4).
- `@testing-library`'s `asyncUtilTimeout` is 5 s now (was 1 s): entering a lazy route waits on a dynamic
  import as well as a render, and under a full suite one second was not enough.

## 8. Files the architect should review

1. `apps/desktop/src/features/setup/ConnectSourcesGate.tsx` (the placement argument, §4.1)
2. `apps/backend/src/scraping/finish.ts` (R86's announcement, and where a run ends)
3. `apps/backend/src/modules/sources/connect-prompt.ts` + `wiring.ts`
4. `apps/desktop/src/features/discover/fallback.test.tsx` (the R78 acceptance, at screen level)
5. `vitest.config.ts` + `apps/backend/src/testing/harness.ts` (R89's project split and the 1 MB fix)

## 9. Next step

**pre-M2b** (ingestion and search corrections, R75's request budget, R81/R87), which also owns the live
runs waiting on `scraper.contactEmail`. Before it, two things want a person: the architect's answer to
question 1, and the packaged-exe click-through in §7.
