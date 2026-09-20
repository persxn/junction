=== WORKER REPORT: WP-05a ===
Status: DONE

Summary (≤5 lines):
`apps/desktop` now exists: a React 19 + Vite 8 front end with `src-tauri` inside it, and a Rust shell that
spawns the backend with `std::process::Command`, puts it in a Job Object, reads the READY line, hands the UI
`{baseUrl, clientSecret, generation}`, restarts it with a *new* secret on a crash (1→2→4…60 s, giving up after
5 crashes in 10 minutes) and shuts everything down on exit. Verified on the built exe, not just in tests:
window close → graceful shutdown, exit 0, no leftovers; a hard kill of the shell takes the backend with it.

Files changed (paths only):
- packages/contracts/src/shell.ts (new), packages/contracts/src/index.ts
- apps/desktop/{package.json,tsconfig.json,vite.config.ts,index.html}
- apps/desktop/src/{main.tsx,App.tsx,app.css}, apps/desktop/src/shell/{backend.ts,backend.test.ts,use-backend.ts}
- apps/desktop/src-tauri/{Cargo.toml,Cargo.lock,build.rs,rust-toolchain.toml,tauri.conf.json}
- apps/desktop/src-tauri/capabilities/default.json, apps/desktop/src-tauri/icons/*
- apps/desktop/src-tauri/src/{main.rs,lib.rs,backoff.rs,ready.rs,secret.rs,paths.rs,job.rs,shutdown.rs,supervisor.rs,commands.rs}
- apps/desktop/src-tauri/tests/supervisor.rs
- eslint.config.js, package.json, tsconfig.json, .gitignore, pnpm-workspace.yaml, pnpm-lock.yaml
- docs/PROGRESS.md

Tests/commands & results:
- `pnpm verify` → **431 tests green (22 s)**; 9 of them new (`apps/desktop/src/shell/backend.test.ts`:
  every IPC payload is parsed against the contract, a non-loopback `baseUrl` or a short secret is refused).
- `cargo test` (`pnpm --filter @compintel/desktop test:rust`) → **34 green, 4.6 s**: 27 unit tests plus 7
  integration tests that supervise a real Node process. The two WP-05a acceptance criteria are
  `tests/supervisor.rs`: *restarts_a_crashed_backend_with_a_new_secret_and_generation* (three spawns, three
  distinct secrets, `Restarting` seen) and *stopping_leaves_no_backend_process_behind* /
  *dropping_the_supervisor_leaves_no_orphan*; `job.rs::closing_the_job_kills_everything_in_it` covers F7/A17
  directly.
- `cargo clippy --all-targets -- -D warnings` → clean. `cargo fmt` applied.
- `pnpm tauri build --debug --no-bundle` → `target/debug/compintel.exe`, 25 s incremental.
- **Two end-to-end runs of the built exe** (scripts in the session scratchpad, not committed):
  1. Graceful: window closed → backend logged `graceful shutdown started/finished` with `reason:"api"`,
     `failures:0`; shell exit code 0; `backend.lock` removed; no process left.
  2. Hard kill (`Stop-Process -Force`, i.e. Task Manager): the node child died with the shell; no leftovers.
  Both runs logged `backend listening … migrationsApplied:2 … jobs:0` and `scheduler started`, so WP-04b's
  migrations and WP-04c's runner are proven end to end.
- **Bonus, and it de-risks WP-05b:** the same log shows `GET /api/v1/health → 200` from the WebView, so
  WebView2 reached the loopback API with the client secret today, with no Local Network Access block. The
  formal flag test (`--enable-features=LocalNetworkAccessChecks,…`) is still WP-05b's job.

Deviations from the prompt (why):
- No tray, close-to-tray, single instance or autostart: those are WP-05b. Until then the window's X exits the
  app, which is also what made the graceful-exit path testable now.
- The UI is a diagnostic panel, not a design: tokens, theming and the app shell are WP-06. `app.css` is
  ~40 lines of placeholder and is meant to be deleted there.
- `--fix` style UI automation (clicking "Exit completely" and "Retry") is not automated; both paths are
  covered at the layer below (`supervisor.stop()`, `supervisor.retry()`), and the window-close path exercises
  the same `stop()`.

Minor decisions made:
1. **No HTTP client dependency.** `POST /api/v1/system/shutdown` is one fixed request to a known loopback
   port, so `shutdown.rs` writes it over `TcpStream` (~40 lines, unit-tested against a real socket). Adding
   `reqwest` (TLS, proxies, redirects, tokio) to a "thin shell" for this seemed worse.
2. **The supervisor knows nothing about Tauri.** It takes an observer callback; `lib.rs` turns that into the
   `backend://status` event. That is what let the acceptance tests run the real lifecycle without a window.
3. **`ready:false` is terminal, not a crash.** A startup error the backend names (`DATA_DIR_LOCKED`,
   `MIGRATION_FAILED`) will not fix itself, so the shell goes straight to `FAILED` with that exact message
   instead of hiding it behind a backoff loop. A missing `node.exe`/bundle behaves the same way.
4. **A backend that never prints READY within 20 s counts as a crash** and goes through the normal ladder.
5. **`generation` starts at 1** on the first spawn and increments on every restart; the UI keys its
   connection on it, so a stale secret can never be rendered as current (A2).
6. **Child exit is polled every 100 ms** rather than waited on: Windows has no signal, and `stop()` has to be
   able to interrupt the wait.
7. **`Supervisor::drop` stops the thread and kills the child**, so even a panicking shell cannot leave an
   orphan; the Job Object is the second line of defence, not the only one.
8. **IPC DTOs live in `packages/contracts`** (`shell.ts`), beside the API DTOs. §3.4 only mentions API
   shapes, but this is still a contract between two processes in this repo, and the UI validating what Rust
   sends has already caught shape drift once during this WP.
9. **Dev paths:** with no `resources\` directory the shell runs `node` from PATH against
   `apps/backend/dist-bundle/main.mjs` and uses `%LOCALAPPDATA%\CompIntel-dev`, never `…\CompIntel`. It also
   passes `--dev` in debug builds (debug logs; the secret still comes from the environment, so no
   `dev-connection.json` is written).
10. **`--stdin-lifeline` is always passed** and the stdin pipe is opened and never written to (A17).
11. **Capabilities are `core:default` only**; app commands need no ACL entry, so nothing else was opened up.
12. **Vite binds `localhost:5173` with `strictPort`** because the CORS allowlist holds that exact origin
    (A3); a silent move to 5174 would look like a shell bug.
13. **Rust checks stay out of `pnpm verify`** (cargo is not on every contributor's PATH and the budget is
    < 2 min, §4.15). They are their own scripts — see Questions.
14. **A placeholder icon** is generated from a committed 10 KB PNG; the Android/iOS/Store icon variants
    `tauri icon` produced were deleted, since only NSIS is in scope.
15. **`gen/` and `dist-types/` are gitignored**; `Cargo.lock` is committed (this is an application).

New dependencies (name@version — why):
- react@19.3.0, react-dom@19.3.0 (+ @types/react@19.3.0, @types/react-dom@19.3.0 dev) — the UI stack §4.2 fixes.
- vite@8.3.0, @vitejs/plugin-react@6.1.1 (dev) — the bundler and dev server §4.2 fixes.
- @tauri-apps/api@2.11.1 — the IPC client (`invoke`, `listen`).
- @tauri-apps/cli@2.11.5 (dev) — `tauri dev|build|icon`, matching the tauri-cli 2.11.4 already installed.
- eslint-plugin-react-hooks@7.1.1 (dev, root) — without it the new React code has no rules-of-hooks check.
  Scoped to `apps/desktop` per R6. Its flat config is `configs.flat['recommended-latest']`; the top-level
  `recommended-latest` is still eslintrc-shaped and makes ESLint 10 fail.
- Rust: tauri@2.11.6, tauri-build@2.6.3, serde@1.0.229, serde_json@1.0.151, windows@0.62.2 (features
  `Win32_Foundation`, `Win32_Security`, `Win32_System_JobObjects`, `Win32_System_Threading` — the Job
  Object API; `Win32_Security` is needed because `CreateJobObjectW` takes `SECURITY_ATTRIBUTES`),
  getrandom@0.4.3 (32 bytes of OS entropy for the client secret; the smallest thing that does only that).
- `pnpm install` auto-added 12 `@tauri-apps/cli*@2.11.5` entries to `minimumReleaseAgeExclude` in
  pnpm-workspace.yaml (the release is newer than the gate). Same behaviour as tsx in WP-03b; no action taken.

Known issues / tech debt:
- **Disk: 33 GB free, down from 42.** `apps/desktop/src-tauri/target` is 5.3 GB on its own. R3 says
  `cargo clean` when free space drops below 20 GB; we are not there yet, but WP-15/26/27 will add more.
- `use-backend.ts` (the React hook) has no test: there is no DOM test environment yet, and setting one up
  (jsdom or @testing-library/react) belongs to WP-06's UI foundation. Its logic is thin and the layer it
  wraps is fully tested.
- The shell has no logging of its own. Supervisor transitions only reach the UI as events, so a shell-side
  problem before the window exists is invisible. The backend's own log covers everything after spawn.
- `explorer.exe` is launched by name for "Open logs"; it is on PATH on every supported Windows, but a
  full path from `%WINDIR%` would be stricter.
- The debug exe keeps a console window (deliberate, `windows_subsystem` only applies to release builds).
- `tauri.conf.json` sets `bundle.targets: ["nsis"]` and `installMode: currentUser` already; nothing is
  bundled into `resources` yet, so a packaged run would not find `resources\node`. That wiring is WP-31's.

Questions for the architect:
1. **Should the Rust checks join `pnpm verify`?** Today `verify` is format/lint/typecheck/test for TypeScript
   only (~22 s) and the Rust ones are separate scripts. Folding in `cargo test` + `clippy` costs ~5 s warm
   but minutes on a cold clone, against the < 2 min budget in §4.15.
2. **Shell-side logging.** Should the shell write its own rotating log next to the backend's (supervisor
   transitions, spawn command lines, Job Object errors), or is the UI event stream plus the backend log
   enough for the pilot? "Copy diagnostics" currently copies only what the UI can see.
3. **`FAILED` on a refused start** (decision 3) means no automatic retry after e.g. `DATA_DIR_LOCKED`, which a
   user can fix by closing the other instance. Should the shell re-try such codes on a slow timer, or keep
   the explicit Retry button?
4. **IPC DTOs in `packages/contracts`** (decision 8): confirm, or should they live in `apps/desktop`?
5. **Window close = exit** until WP-05b lands close-to-tray (D-14). Confirm that the default there should be
   close-to-tray *on*, with "Exit completely" the only thing that stops the backend.

Files the architect should review (≤5, most important first):
1. apps/desktop/src-tauri/src/supervisor.rs — the whole lifecycle, locking and restart policy.
2. apps/desktop/src-tauri/tests/supervisor.rs — what the acceptance criteria are actually asserted against.
3. apps/desktop/src-tauri/src/job.rs — the Job Object and the unsafe blocks.
4. apps/desktop/src-tauri/src/paths.rs — packaged vs dev resolution (A20, and the CompIntel-dev rule).
5. packages/contracts/src/shell.ts — the IPC contract the UI validates.

Suggested next step:
WP-05b (tray icon and menu, close-to-tray toggle, single instance, autostart, and the documented
loopback/CORS/LNA check). The supervisor already survives a window that closes without exiting, so
close-to-tray is a change in one place; the LNA flag run is the one piece that needs a real launch.
===
