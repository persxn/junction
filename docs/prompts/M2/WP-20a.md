WP-20a — Workflows: seeded templates, copy-on-assign, stages and tasks, progress precedence, schedule health

Fresh session. Read ONLY: docs/PROGRESS.md · docs/handoff/pre-M1.md (§1.2–§1.4, §7) · docs/handoff/WP-16b.md (UI
conventions) · docs/handoff/{pre-M2a,WP-17,WP-18}.md · **docs/handoff/WP-19.md** (assign flow, status machine, board — and
every file its review list names) · docs/ARCHITECTURE.md §6.1, §6.2 ("Competitions", "Workflows", `events` Dates,
`event_deadlines`), §6.4, **§11 (every bullet)**, §10.2 (rows "Edit a team, its competitions, workflows…", "Workflow
templates"), §16.2 ("Assign flow", "Competition page"), §16.3, §17, §19 M2, §21 (A12, R12, R32, R35, R78, R89, R91–R98) ·
packages/contracts/src/{permissions,errors}.ts · apps/backend/src/{domain,platform}/**.

STEP 0 — Record the architect's rulings (docs only, first commit "docs: rulings v1.1.18"):
a) Version line → "**Version:** 1.1.18 · **Date:** 22 Sep 2026"; append the changelog row
   "| 1.1.18 | 22 Sep 2026 | Rulings R99–R101: progress and schedule health, due rules, stage ordering (see §21). |"
   If 1.1.18 or R99–R101 are taken, use the next free ones throughout and say so in the report.
b) Insert into §21, directly above the "R91–R113 Reserved" row:
| R99 Progress and health, exactly | A12 as arithmetic: stage progress = SKIPPED → excluded · COMPLETED → 100 (open tasks or not) · `progress_override` present (0 included) → that value, marked "manual" · ≥ 1 task → done ÷ total × 100 · else 0; BLOCKED keeps the computed value. Workflow progress = Σ(weight × p) ÷ Σ(weight) over non-SKIPPED stages; **no counted stage, or counted weights summing to 0 → `null`**, shown with its reason, never 0 %. Health, first match wins: **BLOCKED** (any BLOCKED stage) · **OVERDUE** (an open stage with `due_at < now`; §11's BEHIND, renamed to match §6.4's Overdue badge) · **AT_RISK** (an open stage due within 48 h and < 50 % done) · **ON_TRACK** (≥ 1 open stage dated, or ≥ 1 stage and all COMPLETED/SKIPPED) · **NO_DATES** (no open stage dated, or no stages yet). "Open" = NOT_STARTED, IN_PROGRESS or BLOCKED. Every state carries a one-line reason. A COMPLETED, WITHDRAWN or NOT_SELECTED competition shows its status, not a health. | §11, §6.4, A12 |
| R100 Due rules resolve or stay empty | `due_rule_json` = `{anchor, kind?, offsetDays}`; anchors `REGISTRATION_DEADLINE`, `SUBMISSION_DEADLINE`, `EVENT_START`, `EVENT_END` (the `events` columns) and `DEADLINE` + an `event_deadlines.kind` (earliest row of that kind). Offsets are calendar days in the display zone, keeping the time of day; a DATE-precision anchor resolves to the end of that local day; MONTH, UNKNOWN or absent → `due_at` NULL and "No date — set one", never a guess. Stages keep their rule and a `due_origin` (RULE \| MANUAL \| NONE): a person's date is never recomputed, and a RULE date whose anchor has moved is offered back as "Event deadline changed — update stage dates?", applied only on confirmation. | §11, §6.2, ADR-0015 |
| R101 Ordering and what the schema gains | `workflow_stages.position` and `tasks.position` are REAL, first written 1024 apart; the server computes the midpoint from `{beforeId \| afterId}` — a client never sends a float — and when a gap falls below **1e-6** it renumbers that workflow's rows 1024, 2048, … in the same transaction. §6.2 gains `workflow_stages.due_rule_json?`, `due_origin`, `completed_with_open_tasks`; `workflow_templates.version_no` doubles as the template's optimistic-concurrency version. The five seeded templates are department defaults with fixed UUIDs, inserted if absent at setup completion and at startup (the department does not exist when migrations run). | §6.2, §11 |
c) Add R100/R101's columns to §6.2's Workflows table. PROGRESS.md "Current": next WP WP-20b; roadmap 32 done, 18 remaining.

House rules: every mutation via `withAudit` (reorder, add, remove, status included — §11), R92's no-PII audit wording; stale `version` → 409 "Someone
else changed this — reload to see their change", nothing written; ownership predicates only in `permissions.ts` (R32),
each new action in the matrix test; pure logic in `src/domain/**`, SQL only in repos; `pnpm typecheck` then `db:generate`
(next free number), **never `push`**; `WORKFLOW_` error codes (R12); files < 400 lines; synthetic data only (D-33).

BUILD:
1. **Contracts** `workflows.ts`: `StageStatus`, `DueAnchor`, `DueRule`, `DueOrigin`, `ScheduleHealth`, template/stage/task
   DTOs, `WorkflowView` (progress, health + reason), a label map per enum. Errors `WORKFLOW_NOT_FOUND`,
   `WORKFLOW_OPEN_TASKS` (carries the count), `WORKFLOW_BLOCKED_REASON_REQUIRED`, `WORKFLOW_TEMPLATE_READ_ONLY`,
   `WORKFLOW_ASSIGNEE_NOT_ON_ROSTER`.
2. **Migration**: §6.2's Workflows tables except `resources` (WP-20b) plus R100/R101's columns; CHECKs from the contracts
   enums, `progress_override` 0–100, weight INTEGER 0–10 default 1, `workflows.engagement_id` UQ, CASCADE workflow → stages
   → tasks/assignees, indexes (workflow_id, position) and (stage_id, position).
3. **Domain** `src/domain/workflows/`: `stageProgress`, `workflowProgress`, `scheduleHealth({stages, now, zone})`,
   `resolveDueAt(rule, eventDates, zone)`, `midpoint`/`needsRenumber` — pure, `Clock`-free (take `now`), per R99/R100/R101.
   Reasons: "Blocked: {stage} — {reason}" (+ "and N more") · "{stage} was due {n} days ago, {p}% done" / "{n} stages overdue
   — oldest {stage}" · "{stage} due {today|tomorrow|in 2 days}, {d} of {t} tasks done" (no tasks: "{p}% done") · "Next:
   {stage} due {date}" / "All stages done" · "No stage has a date yet"; append "· {k} stages have no date" when relevant.
4. **Seeded templates** — department defaults; [weight], rule as anchor offsetDays (REG/SUB = registration/submission
   deadline, START/END = event start/end, D:kind = `event_deadlines` kind); 2–4 short imperative default tasks per stage.
   **Hackathon** Team & registration [1] REG −2 · Idea & problem [2] START −3 · Build prototype [4] SUB 0 · Submit & demo
   [2] END 0 · Wrap-up [1] END +7 (record outcome, collect certificates). **Ideathon** Registration [1] REG −1 · Problem
   research [2] D:IDEA_SUBMISSION −5 · Idea deck [3] D:PPT −1 · Submission [2] SUB 0 · Wrap-up [1] END +7. **Innovation
   challenge** Registration [1] REG −2 · Abstract [2] D:ABSTRACT −1 · Prototype [4] D:PROTOTYPE −1 · Final submission [2]
   D:FINAL_SUBMISSION 0 · Wrap-up [1] END +7. **CTF** Registration [1] REG −1 · Practice & tooling [2] START −2 · Compete
   [4] START 0 · Write-ups [1] END +3 · Wrap-up [1] END +7. **Coding contest** Registration [1] REG −1 · Practice set [3]
   START −3 · Contest day [3] START 0 · Upsolve & review [1] END +3. OTHER gets no preselected template.
5. **Templates API** `/api/v1/workflow-templates`: list (defaults + mine + others' read-only), get, **clone** (new template
   owned by the caller, version_no 1), edit name/description/stages (CRUD, reorder, weight, rule as anchor + offset, default
   tasks) — each edit bumps `version_no`, archive. §10.2: a professor edits only templates he created; department defaults
   and `is_default_for_type` are admin-only (`WORKFLOW_TEMPLATE_READ_ONLY` otherwise).
6. **Copy on assign**: insert the template step into WP-19's assign flow → **team or students → workflow template → review
   dates → confirm**. It preselects the department default for the event's type, offers every non-archived template and
   "Blank workflow"; "review dates" shows each resolved `due_at` or "No date — set one", editable (edited → MANUAL). The
   confirm transaction that creates the ASSIGNED competition copies template → `workflows` (`template_id`,
   `template_version_no`) → stages → tasks, times from the `Clock`. CONSIDERING → ASSIGNED on the board runs the same two
   steps: no ASSIGNED-or-later competition lacks a workflow, and template edits never touch an existing one.
7. **Workflow API** under `/api/v1/engagements/:id/workflow`: view; stages add/edit/remove/move (`{beforeId|afterId}`);
   status changes — BLOCKED requires a reason ≤ 200 chars, leaving COMPLETED clears `completed_at/by` and the flag, first
   IN_PROGRESS sets `started_at`; **COMPLETED with open tasks without `openTasks: "CLOSE"|"KEEP"` → 422 `WORKFLOW_OPEN_TASKS
   {count}`**, CLOSE ticks them in the same entry, KEEP sets `completed_with_open_tasks`; override set/clear; assignees
   (active roster members only); tasks add/edit/move/remove and **set done to an explicit value** (never a toggle), ticking
   the first task of a NOT_STARTED stage moves it to IN_PROGRESS; "apply event date changes" per R100. Permission: the
   competition's active primary/co-mentor or an admin. WP-19's list/board DTO gains `progress` + `health`.
8. **UI** — Competition page (§16.2): header (event, team, mentors, status) · progress bar with "{p}%" text (or the null
   reason) + health as icon + label + reason · stages in order with status chip, due date ("No date — set one" when empty),
   overdue badge (derived, never a status), assignees, "manual" marker on an override, "Completed with open tasks" marker,
   notes · task checklist per stage (optimistic, Undo) · the R100 "Event deadline changed" banner · Complete-with-open-tasks
   dialog ("Mark the remaining N tasks done?" · **Yes** · **Complete anyway** · Cancel). **Reorder by keyboard first**:
   Alt+↑/↓ on a focused stage or task, plus Move up/down menu items; pointer drag only if WP-19 ships a drag library — add
   none. Templates list/editor under Competitions → Templates. Empty/error/skeleton states; removals confirm, not Undo.
   `pnpm seed:demo` gives WP-19's demo competitions workflows in states that show all five health values.

TESTS:
- **Precedence, table-driven and exhaustive** over every status × {override absent, 0, 55, 100} × {no tasks, 0/3, 2/3, 3/3}:
  SKIPPED with done tasks excluded · COMPLETED with 0/3 tasks = 100 · override 0 beats 3/3 tasks · absent override falls to
  tasks · BLOCKED keeps 2/3 → 66.7 · no tasks = 0.
- Workflow: all SKIPPED → null + reason · all-zero weights → null · 1/3 vs 3/1 weights differ · SKIPPED weight never in the
  denominator · fast-check: always null or 0–100.
- Health: each state and its reason under a fixed `now`, including BLOCKED beating OVERDUE, AT_RISK at 47 h vs 49 h and 49 %
  vs 50 %, a DATE-precision due today (not overdue until the local day ends), NO_DATES vs partly dated.
- Due rules: each anchor, negative/positive offsets across a month end, DATE vs DATETIME precision, missing anchor → null,
  MONTH precision → null; a MANUAL date untouched when the event deadline moves, a RULE date offered back.
- Copy-on-assign: copy equals template, later template edits leave it unchanged, version recorded; a confirm failing
  mid-way leaves no engagement, workflow or audit row. Reorder: 60 inserts at one spot → one renumber, order kept, audited.
- Matrix rows for every new action (mentor, co-mentor, other professor, admin); a professor editing a default →
  `WORKFLOW_TEMPLATE_READ_ONLY`; an off-roster assignee refused. UI (jsdom): keyboard-only reorder, both dialog answers.

ACCEPTANCE: **the §11 precedence tests pass and are pasted into the report** · `pnpm verify` green in < 120 s (time
reported) · `pnpm test:a11y` and `pnpm e2e` green (e2e: assign an event from Discover with the Hackathon template →
tick a task → progress moves) · files < 400 lines · domain boundary clean.

OUT OF SCOPE: resources or opening any file/link (WP-20b) · outcomes, transfer, student history (WP-21) · deadline radar
and due notifications (WP-22/23) · AI-generated workflows · any `src-tauri` change.

**UI fault sweep** — every screen touched and every screen it links to (board, list, Competition page, assign flow,
Templates, Team page, drawer's Assign): `pnpm test:a11y`, keyboard-only walk, empty/error states, one write under the
F9 fallback (R78), WP-17's rendered-text scan extended to this WP's enums. Fix each; list them under "UI faults fixed" in the handoff.

Finish per CLAUDE.md (verify, PROGRESS.md ≤ 10 lines and < 150 total, docs/handoff/WP-20a.md, commit "WP-20a:
workflows, copy-on-assign, stage and task tracking, progress and schedule health", print the report).
