# `src/domain` — pure logic

The rule, in one line: **pure functions, no I/O, no framework.**

Concretely, a file in here may not import `drizzle-orm`, `better-sqlite3`, `fastify`, `pino`,
`node:fs`, `node:path`, or anything under `src/db/`. That is not a convention — `eslint.config.js`
enforces it with `no-restricted-imports`, so a violation fails `pnpm verify` rather than a review.

It may import `@compintel/contracts` (the enums and DTO schemas are the shared vocabulary),
`src/platform/time.js` (the `Clock` and the local-day arithmetic — also pure), and other domain
files. State is fine when it lives in memory and is handed in; what is banned is reaching out.

## Why the address exists

§3.3 puts domain logic between the application services and the repositories:

```text
Application services      use-cases, authorization, transactions, audit entries
Domain logic (pure)       normalization, dedup scoring, progress, relevance, query DSL, geo
Repositories / clients    Drizzle queries, SearchIndex, LlmClient, PoliteHttpClient
```

M0 barely needed it, which is why there is little here today. M1 changes that: event
normalization, dedup scoring, the `EventQuery` DSL, ranking and the geography policy are all
decision logic with no I/O in them, and all of it is the kind of code that has to be exhaustively
unit-tested. Tests for this directory need no database, no temp directory, no server and no
`await` — if a test in here is slow or flaky, something does not belong in here.

## What lives here now

- `scheduling.ts` — the job runner's arithmetic and predicates: jitter, exponential backoff, "is
  this job due", "has this lease expired".
- `lockout.ts` — ruling R34's lockout ladder, derived from the failure counter rather than stored.

## What deliberately does not

`jobs/schedule.ts` keeps `firstDueAt` and `nextDueAfterRun`. They need a `RegisteredJob`, whose
`nextDueAt` callback is typed against the Drizzle row — so moving them would mean the job-state
shape being defined here and `db/schema` conforming to it. That is worth doing and it is not an
import fix; see the pre-M1 report.
