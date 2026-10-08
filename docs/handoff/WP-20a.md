# WP-20a — Workflows (IN PROGRESS — paused 8 Oct 2026, resume here)

Status: **PAUSED mid step 5 of 9.** About 50% of WP-20a is done. The prompt is `docs/prompts/M2/WP-20a.md`.

## How to resume

1. Read `docs/PROGRESS.md`, then this file, then `docs/prompts/M2/WP-20a.md`.
2. `git log --oneline -12` should show the step commits below, with the WIP checkpoint last.
3. Carry on from **Step 5 — what is left**. Then do steps 6–9, commit each as "WP-20a (n/9): …" and report the % left
   after each one (the owner's standing request).

## Steps and state

| # | Step | Weight | State | Commit |
|---|---|---|---|---|
| 0 | Rulings R99–R101, spec v1.1.18, §6.2 columns | 2% | done | `cdaf4c2` |
| 1 | Contracts (`workflow-enums.ts`, `workflow-templates.ts`, `workflows.ts`), `WORKFLOW_` codes, `workflow.edit`, `workflow_template.clone`; predicates moved to `permission-predicates.ts` | 7% | done | `a76b5f0`, `a22a570` |
| 2 | Migration 0026 (+ `workflows.version`, not in the prompt) | 6% | done | `79cb8b3` |
| 3 | Domain `domain/workflows/{progress,health,due,order}.ts`, 105 tests | 15% | done | `204096d` |
| 4 | Seeded templates (`seed-templates.ts`, fixed ids) and the templates API; seeded at setup and at startup | 12% | done | `2de71ea` |
| 5 | Workflow API, copy-on-assign, progress and health on the list | 20% | **about 60%: code written, untested** | WIP checkpoint |
| 6 | Assign flow: "Workflow template" step at index 1, editable review dates | 8% | todo | |
| 7 | Competition page: stages, tasks, Alt+↑/↓ reorder, both dialogs, date-change banner | 15% | todo | |
| 8 | Templates list and editor (Competitions → Templates) | 7% | todo | |
| 9 | Demo seed with all 5 health states, fault sweep, a11y, e2e, timed verify, final handoff | 8% | todo | |

## Step 5 — what exists (WIP checkpoint)

- `modules/workflows/`:
  - `workflow-repo.ts` — SQL.
  - `workflow-reader.ts` — view; `summaries()` for the list; facts.
  - `writer.ts` — guards, placement, audited.
  - `stages.ts` — add, update, remove, move, status, override, assignees, apply date changes.
  - `tasks.ts` — add, update, move, remove, done.
  - `copy.ts` — `WorkflowCopier.resolve` / `copy` / `onAssigned`.
  - `wiring.ts`.
- `routes/workflows.ts` under `/api/v1/competitions/:id/workflow/…`, plus `POST /workflow-templates/:templateId/resolve`.
- WP-19's `OnAssignedHook` now carries `workflow?: WorkflowChoice`. `AssignRequest` and `TransitionRequest` accept
  `workflow`. `EngagementsDependencies.summaries` fills the list's `progress`, `health` and `healthReason`.
- Wired in `main.ts` and `testing/students.ts`: the workflows module is created first; competitions get
  `onAssigned: [copier.onAssigned]` and `summaries`.
- `pnpm typecheck` is clean, and the whole node project passes (3481 tests) after one change: WP-19's transition test
  now counts only `competition.status_changed` audit rows, because entering ASSIGNED also writes `workflow.created`.

## Step 5 — what is left

1. **Lint** `apps/backend` (not yet run on this checkpoint). Check every file is under 400 lines.
2. **Backend tests** (new `modules/workflows/workflow.test.ts`):
   - copy equals the template, and its version is recorded; a later template edit leaves it unchanged;
   - a confirm failing mid-way leaves no competition, workflow or audit row;
   - CONSIDERING → ASSIGNED copies, and passing `workflow` picks the template and manual dates;
   - stage status rules: BLOCKED needs a reason; COMPLETED with open tasks gives 422 `WORKFLOW_OPEN_TASKS {count}`,
     CLOSE ticks them, KEEP sets the flag; leaving COMPLETED clears; the first IN_PROGRESS sets `started_at`;
   - task done is an explicit value, and the first tick starts the stage;
   - an off-roster assignee is refused; a stale version gives a 409 with "Someone else changed this — reload to see
     their change";
   - reorder is audited;
   - a MANUAL date is untouched when the event deadline moves, and a RULE date is offered in `dateChanges` and applied
     only through `apply-date-changes`;
   - permission rows (mentor, co-mentor, other professor, admin) as API 403s;
   - the list DTO carries `progress` and `health`.
3. Desktop: the fake (`testing/competitions-api.ts`) already returns `progress/health/healthReason: null`. Nothing
   else changes until step 6.
4. Commit "WP-20a (5/9): …".

## Decisions so far (copy into the final report)

- **Deviation:** the workflow API is under `/api/v1/competitions/:id/workflow`, not `/engagements/…`, because WP-19
  named the resource "competitions".
- `workflows.version` was added: structural writes (add, remove or move a stage, apply dates) check it, while stage
  and task writes check the stage's own `version`. So ticking tasks doesn't conflict with edits to other stages.
- `TransitionRequest.workflow` lets the board's CONSIDERING → ASSIGNED run the same template and dates steps (step 6
  UI). With no choice given, the copier uses the department default for the event type, or a blank workflow.
- A stage with a rule keeps `due_origin = RULE` even while the rule gives no date, so R100 can offer the date when
  the event gets one.
- The submission deadline uses the event's `date_precision` (there is no column of its own).
- New permission action `workflow_template.clone` (both roles); `ProblemDetails` gains `count`.

## Question for the architect (from step 3)

- R101's numbers give **two** renumbers for 60 inserts at one spot (1024 / 2³⁰ < 1e-6 on the 30th insert), not the
  one the prompt states. The test asserts renumbers at inserts 30 and 60.
- The open question about verify time (186 s against 120 s) from WP-19 still stands.
