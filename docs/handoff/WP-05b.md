=== WORKER REPORT: WP-05b ===
Status: DONE

Summary (≤5 lines):
The shell now has a tray icon and menu, close-to-tray (on by default, D-14), single instance, a
start-with-Windows setting that really writes the `HKCU\…\Run` entry, and the finding-F9 fallback. The LNA
flag test is done and written up: with Local Network Access checks forced on, the page and IPC still work
but the loopback `fetch` **never settles** - it does not reject - so a rejection-only fallback would hang
for ever. The direct call now has a 5 s timeout and the app switches to a shell-side proxy automatically.

Files changed (paths only):
- apps/desktop/src-tauri/src/{settings.rs,tray.rs,actions.rs} (new)
- apps/desktop/src-tauri/src/shutdown.rs → src/loopback.rs (renamed and generalised)
- apps/desktop/src-tauri/src/{lib.rs,commands.rs,supervisor.rs}, apps/desktop/src-tauri/Cargo.{toml,lock}
- apps/desktop/src/{App.tsx,app.css}, apps/desktop/src/shell/{backend.ts,backend.test.ts,use-backend.ts}
- packages/contracts/src/shell.ts
- docs/research/webview2-local-network-access.md (new), docs/PROGRESS.md

Tests/commands & results:
- `pnpm verify` → **439 tests green (22 s)**; 8 new, covering the settings wrappers and the whole
  transport decision: direct `fetch` with the secret, a `TypeError` fallback, a **silently held request**
  fallback (the case the real run found), staying switched afterwards, and an HTTP status *not* being
  treated as a broken transport.
- `cargo test` → **46 green (4.6 s)**: 39 unit (new: `settings` 6, `tray` 3, `loopback` 8 incl. the
  proxy allowlist) + 7 integration.
- `cargo clippy --all-targets -- -D warnings` clean; `cargo fmt` applied.
- **End-to-end script on the built exe, sections A-D, all pass:**
  - **A** close-to-tray on: closing the window leaves both the shell and the backend running; a second
    launch exits on its own (code 0) and exactly one shell and one backend remain.
  - **B** close-to-tray off: closing the window exits the app, the backend logs
    `graceful shutdown finished reason:"api" failures:0`, and nothing is left.
  - **C** autostart: `autostart:true` in the settings file creates `HKCU\…\Run\CompIntel` pointing at the
    exe; `autostart:false` removes it again. (The test leaves the machine as it found it - no Run entry.)
  - **D** LNA flags on: a health request still reaches the backend, through the shell fallback.
- **Screenshots of the running window** (session scratchpad, not committed) show `API transport: fetch
  (direct loopback)` normally and `shell proxy (fallback)` with the flags on, both with
  `Backend health: ok · v0.1.0 · api 1.0.0 · db ok`.

Deviations from the prompt (why):
- **The fallback is not Tauri's HTTP plugin.** §3.2 suggested it; the shell already speaks HTTP to the
  backend for the shutdown request, so the same 40-line client now also answers a `backend_get` command.
  No new dependency, no new capability, and it is prefix-locked to read-only API paths. Flagged as a
  question below in case the architect wants the plugin anyway.
- The UI is still the WP-05a diagnostic panel plus two checkboxes; tokens and the real settings screen are
  WP-06/WP-07b.

Minor decisions made:
1. **Shell preferences live in `<dataDir>\shell-settings.json`**, not the backend's `settings` table
   (§6.2). The tray, the window and autostart have to behave before the backend is up, before any account
   exists, and even when the database cannot be opened. Defaults: close-to-tray **on** (D-14),
   autostart **off**.
2. **The saved setting wins over the registry at startup.** If the user removed the Run entry by hand, the
   shell puts it back to match the file; `apply_autostart` does nothing when the two already agree, so a
   normal launch writes nothing.
3. **An autostart change that the platform refuses is rolled back** rather than saved, so the checkbox
   never claims something that is not true.
4. **Tray menu**: Open CompIntel · — · Close to tray · Start with Windows · — · Open logs · Exit
   completely. Left click opens the window, right click opens the menu (the Windows convention).
5. **One place for the five actions** (`actions.rs`), shared by the tray and the IPC commands, so the two
   can never drift. `TrayAction::from_id` is a pure function and is unit-tested.
6. **The proxy is read-only and prefix-locked**: `GET` only, under `/api/v1/`, no `..`, no backslashes.
   The WebView is the least trusted part of the app.
7. **A direct request gets a 5 s timeout** (`FETCH_TIMEOUT_MS`) and a timeout counts as a broken
   transport. This is the fix for what the LNA run exposed; the timeout is a per-call option so the test
   does not have to sit through five seconds.
8. **The transport, once switched, stays switched** for the life of the window: it only ever moves from
   `FETCH` to `SHELL`, never back, so there is no flapping.
9. **An HTTP status is never a reason to switch transports** - 401 or 503 is the server answering.
10. **Capabilities stay `core:default`.** The UI calls our own commands, never the autostart plugin
    directly, so nothing new was opened up.
11. **`shutdown.rs` was renamed to `loopback.rs`** now that it has two callers; `request_shutdown` is a
    three-line wrapper over the general `request`.
12. **Single instance is registered first** (the plugin requires it) and its callback just shows the
    window, so a second launch focuses the running app instead of fighting over the data-directory lock.

New dependencies (name@version — why):
- tauri feature `tray-icon` — the built-in tray §4.1 counts on; no extra crate.
- tauri-plugin-single-instance@2.4.5 — the official single-instance plugin (§4.1).
- tauri-plugin-autostart@2.5.1 — the official autostart plugin; writes and removes the `HKCU\…\Run`
  entry, which is what §4.1's "autostart" means on Windows.
- Nothing new on the TypeScript side.

Known issues / tech debt:
- **A UTF-8 BOM in `shell-settings.json` used to revert every preference silently** (`serde_json` rejects
  the BOM, and the code fell back to defaults). Found by the end-to-end run, because PowerShell's
  `Set-Content -Encoding utf8` writes one. `settings::parse` now strips it, with a test. The same class of
  bug is worth watching wherever the app reads a file a human might edit.
- **The 5 s first-call delay under enforced LNA** is real: the app works, but its first health call takes
  five seconds before falling back. See question 2.
- **SSE does not work over the fallback** - it is request/response only. If LNA ever becomes the default,
  WP-07a's authenticated SSE stream needs its own answer (shell-pushed Tauri events, most likely). Written
  up in the research note.
- The shell still has no log of its own (carried over from WP-05a); the only trace of `apply_autostart`
  failing is an `eprintln!` to a console that a release build does not have.
- The tray's check items are re-ticked from the shell, but if a *second* window ever exists the tray
  tooltip and menu are still global - fine today, worth remembering.
- Clicking the tray menu items is not automated (no UI automation in the repo). `TrayAction::from_id` and
  every action it dispatches to are tested; the wiring between them is three lines.

Questions for the architect:
1. **Is the hand-written proxy acceptable as the F9 fallback**, or do you want `tauri-plugin-http` as §3.2
   suggested? The current one adds no dependency and is prefix-locked, but it only does GET.
2. **Under enforced LNA the first call costs 5 s.** Options: shrink the timeout (1-2 s), or have the shell
   probe once at startup and tell the UI which transport to use, so the UI never pays the timeout. The
   second is a little more code and removes the delay entirely - which do you want?
3. **Do the two shell preferences belong in `<dataDir>\shell-settings.json`** (decision 1), or should they
   move into the backend's `settings` table once WP-07b's wizard exists, with the file kept only as the
   pre-login cache?
4. **Autostart scope:** the Run entry is per-Windows-user. On a shared host machine (§3.1) that means
   whoever set it gets the app on their sign-in. Is that the intent, or should it be per-machine (which
   needs admin rights and conflicts with the per-user installer, §4.13)?
5. **Should the tray show state** - a warning badge or tooltip when the backend is FAILED, and the
   freshness line from §16.1? Right now the tray is static and only the window shows status.

Files the architect should review (≤5, most important first):
1. docs/research/webview2-local-network-access.md — the F9 measurement and what it implies for SSE.
2. apps/desktop/src/shell/backend.ts — the transport decision, the timeout and the fallback.
3. apps/desktop/src-tauri/src/loopback.rs — the proxy, and what it refuses to proxy.
4. apps/desktop/src-tauri/src/settings.rs — where the preferences live, defaults, the BOM fix.
5. apps/desktop/src-tauri/src/{tray.rs,actions.rs} — the menu and the five shared actions.

Suggested next step:
WP-06 (UI foundation: tokens light/dark/system, app shell, Ctrl+K stub, API client, error boundary,
toasts, skeletons, empty states). It should take over `apps/desktop/src/shell/backend.ts` as the basis of
the real API client - including the transport fallback - and delete `app.css` and the diagnostic panel.
A DOM test environment (jsdom or @testing-library/react) belongs to that WP too; the React hook here is
the only untested piece of this WP for want of one.
===
