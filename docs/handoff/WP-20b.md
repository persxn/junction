# WP-20b — Resources: references only, the open allowlist in the shell, file and link checks

Status: **PARTIAL** — everything is built and green; two acceptance items are unmet: the **manual run in the
built app is owed** (I can't drive the GUI), and verify takes 176 s against the 120 s budget.

Commits, in order: `16e5fdd` docs: rulings v1.1.19 · `9032c98` (1/7) contracts · `fd0194f` (2/7) migration 0027 ·
`b1cff93` (3/7) classify + lint boundary · `3cc303d` (4/7) API · `5f80a9f` (5/7) shell `open.rs` · `dde76a2` (6/7)
UI · this commit (7/7) sweep, e2e, docs.

## What was built

- **STEP 0:** spec v1.1.19; R102 (the shell decides what opens) and R103 (resources are references with a checked
  status); §6.2 `resources` gains `version`.
- **Contracts:** `resources.ts` (owner kinds, kinds, check statuses, labels, `Resource`, `ResourceList` grouped by
  owner, create/update/delete/check-results bodies); `shell.ts` gains `OpenRefusal` (10 reasons, a sentence each),
  `StatPathsResult`, `PathActionResult`. `RESOURCE_` codes; action `resource.edit` (COMPETITION_MENTOR / admin).
- **Migration 0027** `resources`: CHECKs from the enums, uri ≤ 2048, label ≤ 120, machine label only on LOCAL_PATH,
  `(owner_kind, owner_id)` index, no FK on the polymorphic owner. WP-20a's stage and task deletes now delete their
  resources (and a stage its tasks' resources) in the same transaction. WP-19 has no competition delete.
- **Domain** `domain/resources/classify.ts` (pure): GitHub (normalized), the five cloud hosts, URL, absolute drive/UNC
  paths; `javascript:`/`file:`/`data:`/other schemes and relative paths refused; a chosen kind must fit. ESLint keeps
  `modules/resources/**` off `scraping/**` and network/filesystem modules.
- **API:** `GET /competitions/:id/resources` (all levels, grouped, workflow order), `POST /resources`,
  `PATCH|DELETE /resources/:id` (house 409), `POST /resources/check-results` (LOCAL_PATH only, no audit, no version
  bump). Audit rows name the kind and owner, never the link, path or label (R92).
- **Rust** `open.rs`: `classify_path` → `Open | RevealOnly | Refuse`, then canonicalize, refuse folders, and judge the
  **canonical target** again; the OS gets the canonical path with `\\?\` stripped, through `external.rs`'s
  ShellExecuteW (refactored into `shell_open`; no new crate). Commands in `open_commands.rs`: `open_local_path`,
  `reveal_path` (`explorer.exe /select,"…"`; a refused string is never passed on), `stat_paths` (each probe on its
  own thread, 3 s deadline → UNREACHABLE; max 200), `machine_label` (`COMPUTERNAME`). `pick_file` takes
  `filter: "ANY"` for resources and does not remember that pick for `read_picked_file`. Capabilities stay
  `core:default`; no JS plugin API exposed.
- **UI:** Resources section for the competition (with a guide), per stage (inside the stage card) and per task (rows
  under the task; "Add a resource" in its menu). Add/edit dialog (paste, or Choose file… / Choose folder… in the
  shell), kind as icon + label, editable label. Row actions: Open, Show in Explorer, and Copy / Edit / Remove
  (confirm). Status lines as specified; the shell checks this PC's paths as the page opens and posts the results.
  Outside the shell a path is Copy only, with the reason. Optimistic add with Undo.

## "Executables can't be opened" — `cargo test --lib open::` (pasted)

```
open::tests::every_deny_list_extension_is_refused_in_any_case ... ok   (52 types × lower/UPPER/MiXeD, REPORT.EXE)
open::tests::only_the_last_extension_counts ... ok                    (report.pdf.exe refused, report.exe.pdf opens)
open::tests::a_trailing_dot_or_space_is_refused ... ok                (report.exe. / report.exe␠ / report.pdf.)
open::tests::alternate_data_streams_are_refused ... ok                (file.pdf:evil.exe, file.pdf::$DATA)
open::tests::traversal_is_refused ... ok                              (..\..\Windows\notepad.exe, C:\docs\..\x.pdf)
open::tests::device_paths_are_refused ... ok                          (\\?\C:\x.exe, \\.\PhysicalDrive0)
open::tests::reserved_device_names_are_refused ... ok                 (CON.pdf, nul.txt, com1.docx)
open::tests::relative_paths_and_bare_names_are_refused ... ok         (x.pdf)
open::tests::no_extension_or_an_unknown_one_is_reveal_only ... ok
open::tests::a_directory_is_reveal_only_and_a_missing_file_is_not_found ... ok
open::tests::every_allowlisted_type_opens_when_the_file_exists ... ok (23 types, temp files)
open::tests::a_link_named_like_a_document_is_judged_by_its_target ... ok  (skipped: no symlink privilege — printed)
open::tests::the_canonical_target_decides_even_without_a_real_link ... ok (same rule via an injected probe)
open::tests::a_refused_path_never_reaches_the_opener ... ok            (injected opener asserted uncalled)
open::tests::reveal_selects_a_program_but_never_passes_on_a_refused_string ... ok
open::stat_tests::stat_reports_found_missing_and_what_may_open ... ok
open::stat_tests::a_path_that_does_not_answer_in_time_is_unreachable ... ok
open::stat_tests::the_verbatim_prefix_is_stripped_for_the_os ... ok
open::stat_tests::the_machine_label_is_never_empty ... ok
open::stat_tests::refusals_serialize_as_the_contract_names_them ... ok
test result: ok. 20 passed; 0 failed
```

## Tests and commands

- R19: `cargo test` **106 passed** (99 unit + 7 integration) · `cargo clippy --all-targets -- -D warnings` clean ·
  `cargo fmt --check` clean.
- `pnpm verify` **green in 176 s** (4150 tests, 217 files) — over the 120 s budget. `pnpm test:a11y` 44/44.
  `pnpm e2e` 5/5 (the competitions spec now adds a GitHub link and a path; the path is Copy-only in the web build).
- Backend: `classify.test.ts` (34), `resources-schema.test.ts` (4), `resources.test.ts` (8 — kinds, refusals, owner
  kinds, permission rows, stale 409, check results unaudited, cascades, every fetch went to the test's own server).
- Desktop: `resource-model.test.ts` (7), `resources.test.tsx` (6, shell mocked), `resources-sweep.test.tsx` (5),
  `resources.a11y.test.tsx` (2).

## UI faults fixed (sweep: Competition page, its stages and tasks, the add dialog, board, Team page)

1. A stage's "Resources" heading was an h3 beside the stage's own h3; it is an h4 under it now.
2. A path the shell refused to look up (e.g. one with `..`) would have read "Not found on this PC"; it now shows the
   shell's reason.
3. The audit summary read "Added a file or folder on a pc"; audit rows use their own nouns ("a path on a PC").
- Rendered-text scan extended to resource kinds, owner kinds, check statuses and the ten refusals: clean. Forced
  states: resources failing to load (page stays, Try again), none yet, read-only. F9: an add through the shell proxy.
  Keyboard-only walk: Tab to Add resource, type, Enter, focus returns to the button.

## Owed: the manual run in the built app

In the built app (`pnpm --filter @compintel/desktop tauri build`, or `tauri dev`) on this PC: add `C:\…\any.pdf` →
**Open** opens it; add a copy of any `.exe` → only **Show in Explorer** is offered, and it selects the file without
running it; add any path, then change its PC name in the database (or add it on a second PC) → it reads "On <PC> —
can't check from here". I could not do this: it needs clicking in the real window.

## Deviations from the prompt

- `GET /api/v1/competitions/:id/resources`, not `/engagements/…` — WP-19's resource name, as WP-20a did.
- No existing path-exists command was found in the shell, so `stat_paths` is new rather than an extension.
- The symlink case skips on this account (Windows error 1314, no symlink privilege); a test with an injected probe
  covers the same canonical-target rule.

## Minor decisions made

- A closed competition's resources are read-only, except its **outcome's** once COMPLETED (a certificate arrives
  after the end; WP-21 builds on it).
- Check results may be posted by anyone who can read the competition (it is what their PC sees); only LOCAL_PATH rows
  change; ids of other kinds are skipped.
- Editing a path's text resets it to UNCHECKED.
- A path without a PC name (added outside the shell) is treated as this PC's when checked.
- `machine_label` reads `COMPUTERNAME` (fallback "This PC").
- A refused string is reported by `stat_paths` as MISSING with its reason and is never looked up.

## New dependencies

None (Rust or JS).

## Known issues / tech debt

- **verify 176 s vs 120 s** (pre-M2a Q1).
- A hung network probe keeps its thread until Windows times it out; the answer is no longer waited for.

## Questions for the architect

1. Should `stat_paths` treat a path with no PC name as this PC's (current) or as "unknown PC"?
2. The verify time budget (standing).

## Files the architect should review

1. `apps/desktop/src-tauri/src/open.rs` — R102 in code.
2. `apps/desktop/src-tauri/src/open_commands.rs` — the four commands.
3. `apps/backend/src/modules/resources/service.ts` — permissions, audit wording, check results.
4. `apps/backend/src/domain/resources/classify.ts` — R103's kinds.
5. `apps/desktop/src/features/resources/resource-model.ts` — what a row says and offers.

## Suggested next step

The manual run above, then WP-21 (outcomes and certificates use OUTCOME resources).
