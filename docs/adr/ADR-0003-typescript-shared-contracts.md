# ADR-0003: TypeScript end-to-end with shared zod contracts

- **Status:** Accepted (spec v1.1, 2026-09-20)
- **Date:** 2026-09-20
- **Source:** ARCHITECTURE.md §3.4, §4.0, §4.2, §4.3, §4.4, §8.1

## Context
The UI, API, AI planner and saved searches all need the same DTOs, enums, error codes, permissions
and query language (`EventQuery`). Duplicated definitions drift.

## Decision
- TypeScript (strict) for backend and UI.
- `packages/contracts` holds the zod schemas for API DTOs, the `EventQuery` DSL, enums, error codes and permissions.
- OpenAPI 3.1 is generated from zod (fastify-type-provider-zod). The UI uses a typed API client.
- react-hook-form + zod share validation between UI and backend.
- UI stack: React 19, Vite, Tailwind CSS v4 (design tokens), Radix via shadcn/ui, TanStack
  Query/Router/Table/Virtual, cmdk. Pin versions and justify every dependency.

## Consequences
- One validation source and one query model across the filter UI, saved searches, dashboard and AI.
- Ecosystem churn: pin versions.
- The Rust shell sits outside the shared-type boundary, so it must stay thin.

## Alternatives considered
- Python/FastAPI or ASP.NET backend: splits the language from the UI and weakens shared typing (ADR-0004).
- Svelte/Solid UI: lighter, but a thinner ecosystem for accessible primitives and tables.
