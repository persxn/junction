# ADR-0013: Files: references only; open allowlist

- **Status:** Accepted (spec v1.1, 2026-09-20)
- **Date:** 2026-09-20
- **Source:** ARCHITECTURE.md §1 (D-12), §6.2 (`resources`), §13

## Context
Competitions, stages, tasks and outcomes need attached material (PPTs, repos, certificates). The MVP must not
copy files (D-12). In client mode the backend cannot see a professor's disk.

## Decision
- The `resources` table stores references: URL (http/https only), GitHub URL (normalized),
  cloud-document URL, and local path with a `machine_label`.
- Local paths are validated by the **desktop shell** and shown as "on <PC name>". URLs are recommended for
  anything shared.
- Opening: URLs open in the default browser. Local paths open directly only for document types (pdf, ppt/pptx,
  doc/docx, xls/xlsx, csv, txt, md, png, jpg, zip). Everything else gets **Show in Explorer** only. A stored
  path can never launch a program.

## Consequences
- No storage, quota or backup burden for files. References can go stale (`check_status`).

## Alternatives considered
- A managed project folder with copy-in (`<data>/projects/<competition>/`): a future option.
