# ADR-0015: Time: UTC storage + IANA timezone + precision; IST display

- **Status:** Proposed
- **Date:** 2026-09-20
- **Source:** ARCHITECTURE.md §6.1, §6.4, §7.3

## Context
Deadlines drive the product. Sources state dates with varying precision and timezones ("27 Sep",
"Sep 2026", explicit UTC times), and a wrong deadline is worse than an unknown one.

## Decision
- Store all timestamps as INTEGER Unix milliseconds, UTC. Display in `Asia/Kolkata` (a setting).
- Event dates also store an IANA `timezone` and a precision (`DATETIME | DATE | MONTH | UNKNOWN`).
- Timezone resolution: explicit in the source > venue location (India → Asia/Kolkata) > source default > UTC
  with lowered precision.
- A date-only deadline means the end of that day in the event timezone and is shown as "27 Sep (time not stated)".
- Impossible dates (end before start, year far off) → the field is dropped with a warning, never guessed.
- Derived states (registration state, phase, urgency, overdue) are computed at query time, not stored.

## Consequences
- Correct comparisons and sorting everywhere. Precision is always visible to users.
- Normalization needs extensive tests (≥ 100 cases, fast-check for dates).

## Alternatives considered
- Local-time storage or ISO strings without precision: lose information and make comparisons fragile.
