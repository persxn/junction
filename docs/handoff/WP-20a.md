# WP-20a — Workflows: seeded templates, copy-on-assign, stages and tasks, progress precedence, schedule health

Status: **DONE**, with one acceptance figure unmet (verify wall time; see Known issues).

Commits, in order: `cdaf4c2` docs: rulings v1.1.18 · `a76b5f0`, `a22a570` (1/9) contracts · `79cb8b3` (2/9) migration
0026 · `204096d` (3/9) domain · `2de71ea` (4/9) seeded templates and templates API · `dffa28a` (5/9 WIP) and `01e6a7f`
(5/9) workflow API and copy-on-assign, tested · `ced1194` (6/9) assign flow · `a44b35c` (7/9) Competition page ·
`bc566ad` (8/9) Templates screens · this commit (9/9) seed, sweep, e2e, docs.

## What was built

- **STEP 0:** spec v1.1.18; R99 (progress and health, exactly), R100 (due rules resolve or stay empty), R101 (ordering
  and the schema's new columns); §6.2's Workflows table gained R100/R101's columns.
- **Contracts:** `workflow-enums.ts` (stage statuses, anchors, due rule, origins, healths, labels, `WorkflowChoice`),
  `workflow-templates.ts`, `workflows.ts` (`WorkflowView` with progress, health and reasons, request bodies).
  `WORKFLOW_` codes; `ProblemDetails.count`; actions `workflow.edit` (COMPETITION_MENTOR),
  `workflow_template.clone`, `.manage_own`, `.manage_all`; predicates moved to `permission-predicates.ts`.
- **Migration 0026:** templates, template stages, workflows (+ `version`), stages (`due_rule_json`, `due_origin`,
  `completed_with_open_tasks`, REAL `position`), assignees, tasks; CHECKs from the enums; CASCADE; the two indexes.
- **Domain** `domain/workflows/`: `stageProgress`/`workflowProgress` (R99), `scheduleHealth` with every reason,
  `resolveDueAt` (R100), `midpoint`/`needsRenumber`/`place` (R101), and the five seeded templates — 105 tests.
- **Backend:** templates API (list, get, clone, edit, stages CRUD/reorder, archive; `versionNo` as the version;
  defaults and `isDefaultForType` admin-only); workflow API under `/api/v1/competitions/:id/workflow` (view; stages
  add/edit/remove/move, status rules, override, assignees; tasks add/edit/move/remove/done; apply-date-changes) and
  `POST /workflow-templates/:id/resolve`. Copy-on-assign through WP-19's `onAssigned` seam, inside the confirm's
  transaction; the board's CONSIDERING → ASSIGNED takes `workflow` too. The list/board DTO carries progress and health.
- **UI:** assign flow is now Team or students → **Workflow template** → Review dates (+ each stage's date, editable)
  → Confirm; the board's Considering → Assigned asks the same two steps. Competition page: progress bar + words,
  health as icon + label + reason, R100 banner, stages with status choice, due date, Overdue badge, markers,
  assignees, notes, checklist with optimistic tick + Undo, Alt+↑/↓ and Move up/down, both dialogs, removals confirm.
  Board cards and the list show progress and health. Competitions → **Templates**: list (defaults, yours, others')
  and editor. Every new screen has a guide.
- **Seed:** `seed:demo --students` copies workflows on assignment and shapes five open competitions into BLOCKED,
  OVERDUE, AT_RISK, ON_TRACK and NO_DATES through the real writes.

## §11 precedence tests (pasted, `apps/backend/src/domain/workflows/progress.test.ts`, all green)

```
stage progress precedence (§11, A12, R99) > covers every status × override × tasks combination: 80 cases
  (+ 80 named rows "STATUS · override {null|0|55|100} · {0/0|0/3|2/3|3/3} tasks", each ✓)
stage progress precedence (§11, A12, R99) > SKIPPED with done tasks is excluded                  ✓
stage progress precedence (§11, A12, R99) > COMPLETED with 0 of 3 tasks is 100                   ✓
stage progress precedence (§11, A12, R99) > an override of 0 beats 3 of 3 tasks                  ✓
stage progress precedence (§11, A12, R99) > an absent override falls through to the tasks        ✓
stage progress precedence (§11, A12, R99) > BLOCKED keeps the computed 2 of 3 → 66.7             ✓
stage progress precedence (§11, A12, R99) > no tasks and no override is 0                        ✓
workflow progress (R99) > all SKIPPED → null, with the reason                                    ✓
workflow progress (R99) > counted weights summing to 0 → null, never 0 %                         ✓
workflow progress (R99) > no stages → null                                                       ✓
workflow progress (R99) > weights 1/3 and 3/1 give different answers                             ✓
workflow progress (R99) > a SKIPPED stage’s weight never reaches the denominator                 ✓
workflow progress (R99) > is always null or between 0 and 100 (fast-check)                       ✓
Test Files 2 passed · Tests 105 passed (domain/workflows)
```

## Tests and commands

- `pnpm verify` **green in 183 s** (format, lint, typecheck, 4062 tests in 211 files) — over the 120 s budget.
- `pnpm test:a11y` 42/42 (11 files; new `workflows.a11y.test.tsx`: workflow + banner + menu, both dialogs, board
  card, Templates list, template editor). `pnpm e2e` 5/5 — the competitions spec now picks the Hackathon template,
  opens the competition, ticks a task and sees progress leave 0 %.
- New backend: `workflow-copy.test.ts` (7), `workflow-stages.test.ts` (9), seed test for workflows + five healths.
  New desktop: `template-choice`, `workflow-choice`, `WorkflowSection` (9, incl. keyboard-only reorder and both
  dialog answers), `templates` (8), `rule-text`, `workflows-sweep` (8).

## UI faults fixed (sweep: board, list, Competition page, assign flow, Templates, Team page, drawer's Assign)

1. A task tick flickered back for a frame before the optimistic copy rendered (found by the e2e: Playwright saw "did
   not change"). The clicked value is now held locally until the write settles.
2. The board's Considering → Assigned would have copied the type's default silently; it now asks template + dates.
3. Undo of Assigned → Considering would have asked for a template again; a competition that already has a workflow
   is not asked (the server keeps the first copy).
4. The stage name was a button that did nothing; it now folds the stage (and owns Alt+↑/↓).
5. Archiving a template used a dialog that said "Remove … cannot be undone"; the dialog now takes its verb.
- Rendered-text scan extended to stage statuses, healths, anchors, origins and open-task choices: clean.
  Forced states: workflow load failure (rest of page stays), blank workflow, templates list failure. F9: a task tick
  with the shell proxy as the only transport. Keyboard-only walk: Tab to a task, Space, Alt+↓, Esc out of a dialog.

## Deviations from the prompt

- The workflow API is under `/api/v1/competitions/:id/workflow`, not `/engagements/…`: WP-19 named the resource
  "competitions".
- `workflows.version` was added (not in the prompt): structural writes check it; stage and task writes check the
  stage's own `version`, so ticking tasks does not conflict with edits to other stages.

## Minor decisions made

- `TransitionRequest.workflow` lets the board's CONSIDERING → ASSIGNED carry the choice; with none, the copier uses the
  type's default or a blank workflow.
- A stage with a rule keeps `due_origin = RULE` while the rule gives no date, so R100 offers the date when it arrives.
- The submission deadline uses the event's `date_precision` (there is no column of its own).
- Date boxes are wall-clock time in Asia/Kolkata (fixed +05:30; no daylight saving).
- Progress and health also appear on board cards and as a list column ("{p}% done" + health; reason in the tooltip).
- Templates live at `/competitions/templates[/$id]`, linked from the Competitions header.
- "Just considering" copies no workflow; Confirm says so.

## New dependencies

None.

## Known issues / tech debt

- **verify 183 s vs 120 s** (pre-M2a Q1, still open; WP-19 was 186 s).
- Stage details keep their own field state; another person's edit shows after a reload of that stage's fields.
- `apps/desktop/src/testing/workflows-api.ts` is an in-memory fake with simplified R99 arithmetic (no health
  recomputation beyond BLOCKED); the backend tests own the real rules.

## Questions for the architect

1. R101's numbers give **two** renumbers for 60 inserts at one spot (1024 / 2³⁰ < 1e-6 on the 30th insert), not the
   one the prompt states. The domain test asserts renumbers at inserts 30 and 60; the API test checks order and gaps.
2. Verify time (183 s against 120 s) — the standing question from pre-M2a.

## Files the architect should review

1. `apps/backend/src/modules/workflows/copy.ts` — copy-on-assign inside the confirm's transaction.
2. `apps/backend/src/modules/workflows/stages.ts` — status rules, open-task choice, R100 apply.
3. `apps/backend/src/domain/workflows/health.ts` — R99's health order and reasons.
4. `apps/desktop/src/features/workflows/WorkflowSection.tsx` — the page's workflow.
5. `apps/desktop/src/features/competitions/assign/steps.ts` — the four-step flow.

## Suggested next step

WP-20b (resources) — it reuses `WorkflowView` and the stage card.
