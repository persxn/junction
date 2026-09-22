WP-20b — Resources: references only, the open allowlist in the shell, file and link checks

Fresh session. Read ONLY: docs/PROGRESS.md · docs/handoff/pre-M1.md (§1.2–§1.4, §7) · docs/handoff/WP-05b.md and
docs/handoff/WP-07b.md (the Rust shell: `loopback.rs`, `files.rs`, how R43 is enforced) · docs/handoff/pre-M2a.md (how
`open_external` hands off to the OS) · docs/handoff/WP-17.md (`pick_file`/`read_picked_file`) · docs/handoff/WP-20a.md ·
docs/ARCHITECTURE.md §6.2 (`resources`, `engagement_outcomes`), **§13 (every bullet)**, §10.2, §15, §16.2 ("Competition
page"), §16.3, §21 (D-12, R12, R19, R32, R43, R78, R84, R89, R92) · docs/adr/ADR-0013-files-references-only.md ·
apps/desktop/src-tauri/src/{lib,commands,files,loopback}.rs · packages/contracts/src/{permissions,errors,shell}.ts.

STEP 0 — Record the architect's rulings (docs only, first commit "docs: rulings v1.1.19"):
a) Version line → "**Version:** 1.1.19 · **Date:** 22 Sep 2026"; append the changelog row
   "| 1.1.19 | 22 Sep 2026 | Rulings R102–R103: the open allowlist lives in the shell, resource checks (see §21). |"
   If 1.1.19 or R102–R103 are taken, use the next free ones throughout and say so in the report.
b) Insert into §21, directly above the "R91–R113 Reserved" row:
| R102 The shell decides what opens | `open_local_path(path)` and `reveal_path(path)` are Rust commands and the only way a stored path reaches the OS; the page, the backend and the UI's hints have no say. A path opens only if it is absolute (drive-letter or `\\server\share`), has no `..` segment, no `\\?\` or `\\.\` prefix, no `:` after the drive colon (alternate data streams), no final component ending in `.` or space, no reserved device name, **exists as a file after `canonicalize`**, and the **canonical** target's last extension (lower-cased) is on the allowlist: pdf doc docx xls xlsx ppt pptx odt ods odp rtf txt md csv png jpg jpeg gif bmp webp svg zip mp4. Everything else — no extension, an unknown one, a directory, or the named deny list (exe msi msp bat cmd com ps1 psm1 psd1 vbs vbe js jse wsf wsh hta scr pif lnk url reg cpl inf chm scf jar msc appx msix appxbundle msixbundle application gadget dll ocx sys iso img vhd vhdx docm dotm xlsm xltm pptm potm html htm mht py pyw sh) — gets **Show in Explorer** only, which selects the item in its parent folder and never executes it. The OS is handed the canonical path (its `\\?\` prefix stripped), not the stored string. R43's "a path the user just picked" governs commands that read or write file contents; open and reveal read nothing, so they accept a stored path and rely on these checks instead. | §13, R43, D-12, ADR-0013 |
| R103 Resources are references with a checked status | `resources` gains `version`; `owner_kind` OUTCOME uses the engagement id (the outcome's key). URL, GITHUB and CLOUD_DOC take http/https only (GitHub normalized to `https://github.com/<owner>/<repo>…` without `.git` or trailing slash; CLOUD_DOC = docs.google.com, drive.google.com, onedrive.live.com, 1drv.ms, `*.sharepoint.com`); a URL is **never fetched** and stays UNCHECKED. LOCAL_PATH is checked by the shell on view, never by the backend: OK · MISSING · UNREACHABLE (a network path that does not answer within 3 s) — and a path whose `machine_label` is not this PC is shown "On <PC> — can't check from here", never "broken". Writing a check result is machine state: no audit row and no version bump (R84); adding, editing and removing a resource are audited. Removing a stage, task or competition removes its resources in the same transaction. | §6.2, §13, R84 |
c) PROGRESS.md "Current": next WP is WP-21; roadmap 33 done, 17 remaining.

House rules: every people-made mutation via `withAudit`, R92's no-PII audit wording; stale `version` → 409 "Someone else changed this — reload to see
their change", nothing written; ownership predicates only in `permissions.ts` (R32, matrix test); pure logic in
`src/domain/**`, SQL only in repos; `pnpm typecheck` then `db:generate` (next free number), **never `push`**;
`RESOURCE_` error codes (R12); files < 400 lines; synthetic data only (D-33). **Nothing is ever copied into the app** (D-12).

BUILD:
1. **Contracts** `resources.ts`: `ResourceOwnerKind`, `ResourceKind`, `CheckStatus`, DTOs, label maps; `shell.ts` gains the
   four command signatures and `OpenRefusal` (`NOT_ABSOLUTE`, `TRAVERSAL`, `DEVICE_PATH`, `ALTERNATE_STREAM`,
   `TRAILING_DOT_OR_SPACE`, `RESERVED_NAME`, `NOT_FOUND`, `IS_DIRECTORY`, `BLOCKED_TYPE`, `UNKNOWN_TYPE`) with a sentence
   each ("Programs and scripts can't be opened from CompIntel — use Show in Explorer"). Errors `RESOURCE_NOT_FOUND`,
   `RESOURCE_INVALID_URI`, `RESOURCE_OWNER_NOT_FOUND`.
2. **Migration**: `resources` per §6.2 + R103's `version`; CHECKs from the enums; index (owner_kind, owner_id); `uri` ≤ 2048,
   `label` ≤ 120. No FK on `owner_id` (polymorphic): the repo resolves every owner to its engagement and refuses an unknown
   one. Extend WP-20a's stage/task deletes (and any competition delete WP-19 has) to delete resources in the same transaction.
3. **Domain** `src/domain/resources/classify.ts` (pure): input string → `{kind, uri}` or a refusal — auto-detects GITHUB /
   CLOUD_DOC / URL / LOCAL_PATH, rejects `javascript:`, `file:`, `data:` and relative paths; the user may pick another
   valid kind. The backend validates shape only; it never touches the filesystem or the network. An ESLint
   `no-restricted-imports` block keeps `modules/resources/**` away from `scraping/**` (no PoliteHttpClient here).
4. **API**: `GET /api/v1/engagements/:id/resources` (every level of one competition, grouped by owner), `POST /resources`,
   `PATCH /resources/:id`, `DELETE /resources/:id`, `POST /resources/check-results` (batch of `{id, status, checkedAt}`;
   LOCAL_PATH rows only; R103's no-audit rule). Permission = editing the owning competition (active primary/co-mentor or
   admin); reading follows the open department.
5. **Rust** — `apps/desktop/src-tauri/src/open.rs` (new): a pure `classify_path(&str) -> Decision {Open, RevealOnly(reason),
   Refuse(reason)}` for the string checks, then the filesystem checks, per R102. Commands: `open_local_path(path)`,
   `reveal_path(path)` (files and folders both selected in their parent; a refused string is never passed on),
   `stat_paths(paths[])` → `{machineLabel, results: [{path, status, openable, reason?}]}` — extend the shell's existing
   path-exists command into this batch rather than adding a second one; each probe on a blocking thread with the 3 s
   network timeout — and `machine_label()` (the Windows computer name). Hand-off uses the same mechanism pre-M2a's
   `open_external` uses; add no crate unless that is `tauri-plugin-opener` (Rust API only). **No JS plugin API exposed,
   capabilities stay `core:default`.** Adding a LOCAL_PATH reuses WP-07b's `pick_folder` and WP-17's `pick_file` (give it
   a filter argument: WP-17's CSV/XLSX by default, none for resources); only the path is returned, `read_picked_file` is
   never called and nothing reads the file.
6. **UI** on the Competition page: a Resources section per competition, per stage and per task; "Add resource" (paste a
   link or path, or Choose file… / Choose folder…), kind shown as icon + label, editable label. Actions per row: **Open**
   (URLs through `open_external`; LOCAL_PATH through `open_local_path` only when `stat_paths` said `openable`), **Show in
   Explorer**, Copy, Edit, Remove (confirm). Status line: "Not found on this PC — checked 2 min ago", "Network location
   didn't answer", "On LAB-PC-07 — can't check from here"; nothing for UNCHECKED links. `stat_paths` runs when the page or
   a stage opens and posts results back. Outside the shell (web build, `pnpm e2e`) LOCAL_PATH shows Copy only, with that
   reason. Optimistic add with Undo; empty/error/skeleton states.

TESTS:
- **Rust — the §19 acceptance, `open::tests`**: every deny-list extension refused, each in lower, UPPER and MiXeD case
  (`REPORT.EXE`); double extensions `report.pdf.exe` refused and `report.exe.pdf` allowed; trailing dot/space
  (`report.exe.`, `report.exe `, `report.pdf.`); `file.pdf:evil.exe` and `file.pdf::$DATA`; `..\..\Windows\notepad.exe`
  and `C:\docs\..\x.pdf`; `\\?\C:\x.exe`, `\\.\PhysicalDrive0`; `CON.pdf`, `nul.txt`; relative `x.pdf`; no extension; a
  directory (reveal only); a missing file; every allowlisted type opens (temp files); a symlink named `doc.pdf` whose
  target is an `.exe` refused on the canonical target (skipped with a printed note if the OS denies symlink creation).
  `open_local_path` on a refused path returns the refusal and **calls no OS hand-off** (injected opener, asserted uncalled).
- Backend: kind detection and GitHub/cloud normalization table; `javascript:`/`file:` refused; OUTCOME owner resolves to
  its engagement; permissions matrix rows; stale version 409; check-results write no audit row; deleting a stage deletes
  its resources; no request leaves the process (fake fetch asserted uncalled).
- UI (jsdom, shell mocked): an `.exe` resource offers Show in Explorer and no Open; another-PC label; web build shows Copy.

ACCEPTANCE: **executables can't be opened** — the Rust test above passes, output pasted · `cargo test`, `cargo clippy
-- -D warnings`, `cargo fmt --check` run and reported (R19) · `pnpm verify` green < 120 s (time reported) · `pnpm test:a11y`
and `pnpm e2e` green · a manual run in the built app opens a PDF, reveals an `.exe` without running it, and labels a path
from another PC · files < 400 lines.

OUT OF SCOPE: copying, uploading, previewing or hashing files · the managed project folder (§13 "Future") · fetching or
link-checking URLs · outcomes and certificates UI (WP-21 uses this) · notifications.

**UI fault sweep** — every screen touched and every screen it links to (Competition page, its stages and tasks, the add
dialog, board, Team page): `pnpm test:a11y`, keyboard-only walk, empty/error states, one write under the F9 fallback
(R78), WP-17's rendered-text scan extended to this WP's enums. Fix each; list them under "UI faults fixed" in the handoff.

Finish per CLAUDE.md (verify, PROGRESS.md ≤ 10 lines and < 150 total, docs/handoff/WP-20b.md, commit "WP-20b:
resources as references, shell-side open allowlist and path checks", print the report).
