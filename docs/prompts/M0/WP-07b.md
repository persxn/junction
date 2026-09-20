WP-07b — First-run setup wizard (admin, organization, campus, scraper contact, folders, backup passphrase → age keys + recovery file) and user administration

Fresh session. Read ONLY: docs/PROGRESS.md · docs/handoff/WP-07a.md · docs/handoff/WP-06.md ·
docs/adr/ADR-0010-auth-local-accounts.md · docs/adr/ADR-0011-backups-age-encryption.md ·
docs/ARCHITECTURE.md §4.12, §4.13 ("Data directory" bullet), §6.2 ("Organization & configuration" and
"Identity & access" tables), §7.2 (the UA/contact bullet only), §10.2, §14 ("Backup pipeline" and "Keys"
paragraphs), §16.3 · docs/requirements/master-requirements.md (search for "setup" and "first run") ·
packages/contracts/src/*.ts · apps/backend/src/modules/auth/** · apps/backend/src/db/schema/*.ts ·
apps/desktop/src/{api,app,components}/** · apps/desktop/src-tauri/src/{commands.rs,actions.rs,lib.rs}.

STEP 0 — Record the architect's rulings (docs only, first commit "docs: rulings v1.1.5"):
a) Version line → "**Version:** 1.1.5"; changelog row
   "| 1.1.5 | 20 Sep 2026 | Rulings R39–R44: setup wizard, recovery material, folder validation (see §21). |"
b) Append to the §21 table:
| R39 Setup gate | Until an ACTIVE ADMINISTRATOR exists, every route except `/health`, `/api/v1/setup/*` and `/system/client-log` answers **409** with code `SETUP_REQUIRED`. The UI cannot route past the wizard, and the gate is server-side so it cannot be skipped by a reload. | §4.12, §19 |
| R40 Setup is one transaction | Organization, managing department, primary campus, the first admin with their roles, the `settings` rows and the backup key material are written in a single SQLite transaction. A failure leaves no partial setup. `POST /setup/complete` is refused once an admin exists. | §6.2, §14 |
| R41 Recovery material | Two separate secrets. (1) A one-time **admin recovery code**: 32 random bytes, Crockford base32 in groups of 5, shown once, stored only as an Argon2id hash in `settings` (`auth.recoveryCodeHash`). (2) The **backup passphrase**, which never leaves the moment it is typed: it encrypts the age private key. The wizard cannot be finished until the user confirms in writing (an explicit checkbox per item) that both the code and the exported recovery file are saved. | §4.12, §14 |
| R42 Backup keys | `age-encryption` (the TypeScript implementation) generates the X25519 identity at setup. `settings.backup.publicKey` holds the public key in the clear, `settings.backup.privateKeyEncrypted` holds the identity encrypted to a scrypt (passphrase) recipient. Unattended daily backups use the public key only. The recovery file is `compintel-recovery-<yyyyMMdd>.txt` and contains the public key, the passphrase-encrypted identity, the schema version and instructions for the standard `age` CLI — no plaintext key, no admin recovery code. Passphrase rules: ≥ 12 characters, typed twice, and not equal to the admin password. | §14, ADR-0011 |
| R43 Folders | The **data folder is fixed for the process** by the shell (`--data-dir`), so the wizard shows it read-only with a note that changing it is an installer choice (WP-31). The **backup destination** is chosen in the wizard and validated by the backend: exists, writable (write-probe, not `fs.access`), not inside the data directory, and ≥ 1 GB free. Both the folder picker and writing the recovery file are shell concerns and go through Tauri commands restricted to a path the user just picked in a native dialog. | §4.13, §3.2 |
| R44 Scraper contact | `settings.scraper.contactEmail` is required by the wizard and validated as an e-mail; ruling A10 stands — no source may be scraped before setup is complete, and WP-09a asserts that. | §7.2, A10 |
c) PROGRESS.md "Current": next WP is WP-08a; roadmap 14 done, 32 remaining. Mark Q3 (campus name and
   coordinates) as collected at runtime by this wizard, so it no longer blocks anything.

BUILD:
1. contracts — `setup.ts`: SetupStatus {required, hasAdmin, hasOrganization, hasBackupKey}, SetupRequest
   (organization {name, shortName}, department {name, code}, campus {name, lat, lon}, admin {email,
   displayName, password}, scraperContactEmail, backupDir, backupPassphrase), SetupResult {recoveryCode,
   recoveryFile}, PathCheckRequest/Result {ok, reason?, freeBytes?}, and the admin user DTOs
   (UserSummary, CreateUserRequest, ResetPasswordResult). Add ErrorCodes `SETUP_REQUIRED`,
   `SETUP_ALREADY_DONE`, `SETUP_PATH_UNUSABLE`, `SETUP_PASSPHRASE_WEAK` (R12 prefixing). Tests per schema,
   including lat/lon ranges and the e-mail rule.
2. Backend `src/modules/setup/`:
   - The R39 gate as a preHandler registered after the session hook, exempting `/health`, `/setup/*` and
     `/system/client-log`; it must be cheap (one cached "an admin exists" flag, invalidated on completion).
   - `GET /api/v1/setup/status` · `POST /api/v1/setup/check-path` · `POST /api/v1/setup/complete` (R40, one
     transaction, no session required *only while setup is required*; refused with `SETUP_ALREADY_DONE`
     afterwards). Every write audited with `actorKind` USER once the admin row exists, including a
     `setup.completed` entry.
   - Settings writes: `scraper.contactEmail` (R44), `backup.publicKey`, `backup.privateKeyEncrypted`,
     `backup.destinationDir`, `backup.dailyTimeLocal` (default 13:00 per §14), `auth.autoLockMinutes` (15),
     `auth.recoveryCodeHash` (R41), `geography.*` defaults. One typed settings registry module with a zod
     schema per key — no stringly-typed reads anywhere else.
3. Backend `src/modules/users/` (admin only, via WP-07a's `assertCan`): `GET /api/v1/admin/users` ·
   `POST /api/v1/admin/users` (creates with `must_change_password` true, returns a generated first password
   once) · `POST /api/v1/admin/users/:id/disable` and `/enable` · `POST /api/v1/admin/users/:id/reset-password`
   (returns the new one-time password) · `PATCH /api/v1/admin/users/:id` (display name, roles) with `version`
   optimistic concurrency → 409. A user may never disable or demote their own last admin role — test it.
   Every action audited.
4. Backup key material: `src/modules/backup/keys.ts` only — generate the identity, encrypt it to the
   passphrase, decrypt it back (used by the test and later by WP-28), and render the recovery file text.
   **No backup pipeline, no scheduler job** — WP-28 owns those (R22).
5. Shell (src-tauri): a `pick_folder` command and a `save_text_file` command, each taking only a path the user
   just chose in a native dialog (tauri-plugin-dialog), refusing to write anywhere else, and refusing an
   existing file unless the caller passes an explicit overwrite flag. Justify the plugin in the report. R19
   applies: run and report `cargo test`, `clippy -D warnings`, `fmt --check`.
6. UI — the wizard (`apps/desktop/src/features/setup/`), built on WP-06's shell, tokens and states:
   steps **Welcome → Organization & department → Campus (name, lat/lon, with a "use these coordinates" note
   that Q3 is answered here) → Administrator account → Scraper contact e-mail → Folders (data folder read-only,
   backup folder picked and checked) → Backup passphrase → Save your recovery material → Done**.
   Rules: no step can be skipped, Back never loses entered values, the passphrase step explains in one sentence
   that losing both the passphrase and the file makes backups unreadable (§14), and the final step forces the
   recovery-file export and the two confirmation checkboxes (R41) before Finish is enabled. Every field has a
   label, an error message and a keyboard path; axe clean on every step.
7. UI — user administration (`features/admin/users`): the list with status and roles, create, disable/enable,
   reset password (the one-time password shown once with a copy button), and edit. Empty and error states from
   WP-06; the 409 path shows the "someone else changed this" message.

TESTS (all in pnpm verify):
- the gate: before setup every route answers 409 `SETUP_REQUIRED` while `/health` and `/setup/*` work; after
  setup the gate is off and `/setup/complete` answers `SETUP_ALREADY_DONE`.
- `POST /setup/complete`: the happy path writes exactly the expected rows; an injected failure at the last step
  leaves **no** organization, department, campus, user or settings row (R40); the admin can log in afterwards
  with `must_change_password` false (they chose the password themselves).
- path checks: missing, a file instead of a directory, read-only, inside the data directory, and low free space
  — each with its own reason string.
- passphrase: < 12 characters, mismatch, equal to the admin password — each refused with
  `SETUP_PASSPHRASE_WEAK`.
- keys (R42): encrypt a payload to the stored public key, decrypt it with the passphrase-decrypted identity;
  a wrong passphrase fails cleanly; the recovery file contains the public key and the encrypted identity and
  **no plaintext key and no recovery code**; the recovery code is stored only as a hash and verifies.
- user admin: create → must change password; disable → login refused with `AUTH_ACCOUNT_DISABLED`; reset →
  the old password stops working; a professor calling any of these gets 403; the last admin cannot disable or
  demote themselves; `version` conflict → 409; an audit row per action.
- wizard UI: **cannot be skipped** (deep-linking a later step or another route redirects back — the §19
  acceptance criterion); Back keeps values; Finish disabled until the recovery file is exported and both
  checkboxes are ticked (**recovery file exported** — the other §19 criterion); axe clean per step.
- the shell commands: a path outside the picked one is refused; an existing file is not overwritten without the
  flag (Rust tests).

ACCEPTANCE: `pnpm verify` green · the wizard cannot be skipped and the recovery file is exported before Finish ·
`smoke:bundle` passes · the three Rust checks reported (R19) · `pnpm audit:deps` reported · a manual run on a
**fresh data directory** (use a throwaway `--data-dir` under %LOCALAPPDATA%\CompIntel-dev, never the repo)
goes wizard → dashboard → sign out → sign in, and a second launch skips the wizard (say how you checked) ·
files < 400 lines.

OUT OF SCOPE: the backup/restore pipeline and exports (WP-28), the audit viewer and system health (WP-30),
notification preferences (WP-23, Q4), students/teams/events, moving the shell preferences into `settings`
(R28 says they stay in the file), SSO, changing the data directory at runtime (WP-31).

Finish per CLAUDE.md (verify, PROGRESS.md ≤ 10 lines and < 150 total, docs/handoff/WP-07b.md, commit
"WP-07b: setup wizard and user administration", print the report). Close the M0 milestone in the report with a
one-paragraph demo script for the product owner: launch → wizard → sign in → shell → lock → unlock → tray →
exit completely.
