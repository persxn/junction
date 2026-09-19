# ADR-0008: Scheduler: DB-backed in-process job runner

- **Status:** Proposed
- **Date:** 2026-09-20
- **Source:** ARCHITECTURE.md §4.9

## Context
Scrapes, deadline evaluation, backups and cleanup must survive restarts and sleep/resume without timer
drift, and must be observable.

## Decision
- `job_state` rows (`last_run_at`, `last_success_at`, `next_due_at`, `running_since`,
  `consecutive_failures`, `backoff_until`). A 30-second tick runs jobs with `next_due_at ≤ now`.
- Per-job single-flight. Global limits: 2 concurrent scrapes, 1 LLM job. Jitter, stale-lock recovery, and an
  offline check before scraping (`SKIPPED_OFFLINE`).
- Jobs: `scrape:<source>` (15 min default), `detail-refresh`, `deadline-evaluator` (5 min),
  `saved-search-evaluator`, `backup:daily` (catches up if missed), `cleanup` (daily), `health-snapshot` (hourly).

## Consequences
- Catch-up after a restart or sleep is automatic.
- About 200–300 lines of custom code, which must be heavily tested.

## Alternatives considered
- croner/node-cron: in-memory, no state or catch-up.
- Windows Task Scheduler: external, harder to package and observe.
- BullMQ: needs Redis.
