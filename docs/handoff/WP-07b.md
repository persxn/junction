# WP-07b — First-run setup wizard and user administration

=== WORKER REPORT: WP-07b ===
Status: DONE

Summary (≤5 lines):
A fresh installation now configures itself. The R39 gate answers 409 `SETUP_REQUIRED` on every route
until an ACTIVE administrator exists; the nine-step wizard collects organization, department, campus,
the first admin, the scraper contact, the backup folder and the backup passphrase, and writes all of
it — plus the age key pair and the settings rows — in one transaction (R40). The user sees the
recovery code and the recovery file once and cannot finish before both are saved (R41/R42). Admin →
Users can create, disable/enable, rename, re-role and reset passwords, and can never remove the last
administrator.

Files changed (paths only):
- packages/contracts: `setup.ts`, `setup.test.ts`, `errors.ts` (+`SETUP_*` codes), `errors.test.ts`, `index.ts`
- apps/backend: `modules/setup/{gate,service,repository,paths,recovery-code}.ts` (+ tests),
  `modules/users/{service,repository}.ts`, `modules/backup/keys.ts` (+ test),
  `routes/{setup,admin-users}.ts` (+ tests), `testing/setup-server.ts`,
  `platform/{settings,authn,errors}.ts`, `app.ts`, `main.ts`, `tools/smoke-bundle.ts`, `package.json`
- apps/desktop UI: `features/setup/**` (wizard, `wizard-state.ts`, `steps/**`, `SetupGate.test.tsx`),
  `features/admin/users/**`, `api/{setup,admin-users}.ts`, `shell/connection-context.tsx`,
  `shell/backend.ts`, `app/{App,router}.tsx`, `styles/app.css`, `testing/render.tsx`
- apps/desktop/src-tauri: `files.rs` (new), `commands.rs`, `lib.rs`, `Cargo.toml`, `Cargo.lock`
- docs: `ARCHITECTURE.md` v1.1.5 (R39–R44, committed separately as `docs: rulings v1.1.5`), `PROGRESS.md`

Tests/commands & results:
- `pnpm verify` — **green: 1736 tests (1429 node + 307 desktop)**, up 129 from WP-07a's 1607.
- `pnpm --filter @compintel/backend smoke:bundle` — **PASSED**, and it now drives the wizard: fresh
  data dir → `/auth/login` 409 SETUP_REQUIRED → check-path → complete → login 200 → second complete
  409 SETUP_ALREADY_DONE → restart applies nothing.
- Rust (R19): `cargo fmt --check` clean · `cargo clippy --all-targets -D warnings` clean ·
  `cargo test` **56 passed** (49 lib incl. 7 new `files::tests`, 7 supervisor).
- `pnpm audit:deps` — no known vulnerabilities (moderate and above).
- **GUI click-through of the built exe** (`tauri build --debug --no-bundle`, fresh `COMPINTEL_DATA_DIR`,
  driven over the WebView2 DevTools protocol with real mouse and key events): all nine steps, both native
  dialogs, screenshots per step. Folder check reported "Looks good — 28.8 GB free"; Finish stayed disabled
  with the file saved and only one box ticked, and enabled on the second; the exported
  `compintel-recovery-20260920.txt` (1726 bytes) carries `age1…` and the armored block and **no plaintext
  identity and no recovery code**; Finish → sign in → shell. Then Admin → Users: created a colleague, the
  one-time password was shown once, the row read "Professor · Active · Must change password". A **second
  launch on the same data directory went straight to sign-in, not the wizard**; signing in with the
  one-time password forced the password change, after which the professor's shell has **no ADMIN section**.
- Manual run on a throwaway data directory (`%LOCALAPPDATA%\CompIntel-dev\manual-wp07b`, bundled
  backend, script kept out of the repo): health 200 · `/auth/login` and `/me` both 409 SETUP_REQUIRED ·
  `setup/status` required=true · check-path ok with 31.4 GB free · `setup/complete` 200 in **978 ms**
  (two Argon2id hashes + scrypt) · recovery file carries `age1…` and no `AGE-SECRET-KEY-` ·
  admin login 200 with `mustChangePassword=false` · `/admin/users` 200 with one user · after a
  restart `setup/status` is `required=false, hasAdmin/hasOrganization/hasBackupKey=true` and the same
  password still signs in — that is how "a second launch skips the wizard" was checked.

Deviations from the prompt (why):
- The gate also exempts `/system/shutdown`: the tray's "Exit completely" has to work from inside the
  wizard. `/health`, `/setup/*` and `/system/client-log` are exempt as specified.
- `smoke:bundle` had to change: it proved the Argon2id addon with a 401 from `/auth/login`, which the
  R39 gate now turns into a 409. It completes the wizard instead and proves the addon with a 200 —
  a stronger check, since it exercises age/scrypt in the bundle too.
- The wizard UI test file sets `testTimeout: 30_000`. Each case drives ~100 keystrokes through
  `userEvent`; alone the file runs in 8 s, but under the full 69-file suite one case crossed the 5 s
  default. The work is unchanged, only the budget.

Minor decisions made:
- Gate order: the setup gate is registered **before** the session hook, so a fresh install answers
  "not configured" rather than "not signed in".
- `SetupService` caches "an admin exists" in memory; it only ever flips once, and `invalidate()`
  exists for the tests.
- Expensive hashing (2× Argon2id + scrypt) happens outside the SQLite transaction, so the write lock
  is held for microseconds.
- scrypt work factor **18** (age's own default, ≈256 MiB transient) rather than 19: §5's pilot box is
  8 GB and also runs a model.
- `backup.dailyTimeLocal` defaults to `13:00` and `auth.autoLockMinutes` to 15, both written at setup;
  `geography.policy` gets the §7.4 default (`allowCountries: ['IN']`) so WP-08b has something to edit.
- `settings.ts` is now the single typed registry — one zod schema per key, no stringly-typed reads.
- Shell safety (R43): `pick_folder` records the folder the user picked **in this run**; `save_text_file`
  refuses any folder not on that list, any name that is not a plain file name, and an existing file
  unless `overwrite` is passed. The page never gets the dialog plugin's own JS API.

New dependencies (name@version — why):
- `age-encryption@0.3.1` (backend runtime) — R42 names it: the TypeScript age implementation, used to
  generate the X25519 identity, wrap it to a scrypt (passphrase) recipient and armor it. No native code.
- `tauri-plugin-dialog@2.7.3` (Rust, pulls `rfd@0.16.0`) — the native folder picker. Registered for its
  Rust API only; the JavaScript surface is deliberately not exposed, so the page cannot open dialogs.

Known issues / tech debt:
- `pnpm --filter @compintel/backend seed:dev` still exists; the wizard replaces it, so it can go when
  someone is next in that file.
- `check-path` reports `MISSING` before `INSIDE_DATA_DIR` for a non-existent folder inside the data
  directory. Both refuse it; only the reason string is less specific.
- `smoke:bundle` cleanup is best-effort (`removeTempDir`): Windows holds the SQLite/addon handles for a
  moment after exit, and the old `rmSync` in the `finally` masked real failures with EPERM.
- Driving the built app needs `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`
  and Win32 `WM_SETTEXT`/`BM_CLICK` for the native folder dialogs — UIA exposes them as bare panes and
  `SendKeys` does not reach the folder edit. Worth a project skill if the GUI run is repeated.

Questions for the architect:
1. The recovery **code** is stored as `auth.recoveryCodeHash` but nothing consumes it yet — which WP
   owns "sign in with the recovery code when the last admin is locked out"? (WP-07a has the lockout
   ladder; R41 only says the code exists.)
2. R43 says the backup folder must not be inside the data directory. Should it also refuse a folder
   inside the repo, or a removable drive that may not be present at 13:00?
3. Does disabling the last administrator ever need to re-open the wizard (gate invalidation), or is
   "the last admin cannot be disabled" the whole answer? Implemented as the latter.

Files the architect should review (≤5, most important first):
1. `apps/backend/src/modules/setup/service.ts` — the R40 transaction and what is refused before it.
2. `apps/backend/src/modules/backup/keys.ts` — R42's key material and the recovery file text.
3. `apps/desktop/src-tauri/src/files.rs` — the write-authorisation rules.
4. `apps/backend/src/modules/users/service.ts` — last-administrator protection and optimistic concurrency.
5. `apps/desktop/src/features/setup/wizard-state.ts` — per-step validation and what Finish requires.

Suggested next step: WP-08a.
===

## M0 demo script (for the product owner)

Launch `compintel.exe` on a machine that has never run it: the window comes up on **Welcome to
CompIntel** and there is nothing else to click — no menu, no rail, no way to type a URL past it, and
the backend refuses every other request while it is there. Walk the nine steps: the institution and
department, the campus with its coordinates (this is the answer to the old Q3 — the campus is
collected here, not baked in), the first administrator account, the e-mail address that event sites
will see in our scraper's User-Agent, the folders (the data folder is shown read-only, the backup
folder is picked in a real Windows dialog and checked for space and writability while you wait), and
the backup passphrase, with one sentence saying plainly that losing both the passphrase and the file
makes backups unreadable. The last step shows the one-time recovery code and asks you to export the
recovery file; **Finish stays greyed out** until the file has been written and both checkboxes are
ticked. Finish lands you on the sign-in screen — sign in as the administrator you just created, and
the shell opens: rail, command palette, theme switch, Admin → Users where you can add a colleague and
hand them a one-time password. Leave it alone for fifteen minutes (or lock it yourself) and it locks;
your password unlocks it without losing the page. Close the window and it goes to the tray, where the
menu offers Open, Start with Windows, Open logs and **Exit completely** — that last one really exits,
and starting it again goes straight to sign-in, never back to the wizard.
