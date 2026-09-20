# Competition Intel

Desktop application for discovering, tracking and assigning student competitions
(hackathons, CTFs, coding contests, innovation challenges).

The architecture is specified in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md); decisions
live in [`docs/adr/`](docs/adr/) and current status in
[`docs/PROGRESS.md`](docs/PROGRESS.md).

> **Status:** scaffold only. The Fastify backend, database, Tauri shell and UI arrive in
> WP-04a onward.

## Prerequisites

| Tool                                 | Version                                                     |
| ------------------------------------ | ----------------------------------------------------------- |
| Node.js                              | 24.19.0 (`.node-version`; `engines` requires `>=24.19 <25`) |
| pnpm                                 | 12.4.2 (pinned by `packageManager`)                         |
| Rust (toolchain for the Tauri shell) | 1.98.1, `stable-x86_64-pc-windows-msvc`                     |
| Visual Studio Build Tools 2022       | with "Desktop development with C++" (MSVC + Windows 11 SDK) |

Windows also needs **long paths enabled** (`LongPathsEnabled=1`) and **Smart App Control
off**, because local debug builds are unsigned — see
[`docs/adr/ADR-0018-build-machine-prerequisites.md`](docs/adr/ADR-0018-build-machine-prerequisites.md).

`corepack enable` needs administrator rights on this machine; installing pnpm with
`npm i -g pnpm@12.4.2` works without them.

## Install

```sh
pnpm install --frozen-lockfile
```

## Verify

```sh
pnpm verify
```

runs, in order and stopping at the first failure:

| Script              | Does                                   |
| ------------------- | -------------------------------------- |
| `pnpm format:check` | Prettier, check only                   |
| `pnpm lint`         | ESLint flat config, type-checked rules |
| `pnpm typecheck`    | `tsc -b` across all project references |
| `pnpm test`         | Vitest, single run, no watch           |

`pnpm format` rewrites files; `pnpm clean` removes the TypeScript build outputs.
`docs/` and `CLAUDE.md` are excluded from Prettier — they are committed verbatim.

## Layout

```text
competition-intel/
├─ apps/
│  └─ backend/        @compintel/backend — Fastify service (all business logic)
├─ packages/
│  └─ contracts/      @compintel/contracts — zod schemas: DTOs, enums, error codes
├─ tools/             ai-eval harness, perf data generator, scripts (empty for now)
├─ resources/         gazetteer build script, seeds, workflow templates (empty for now)
└─ docs/              ARCHITECTURE.md · DECISIONS.md · adr/ · handoff/ · research/
```

`apps/desktop` (React UI + the Rust Tauri shell) joins the workspace in a later WP.
The full intended layout is in ARCHITECTURE.md §3.4.

## Conventions

- TypeScript strict, `NodeNext` modules — **relative imports carry a `.js` extension**
  even in `.ts` sources.
- Packages are `composite` and wired with project references; `tsc -b` builds them in order.
- Enum values in `packages/contracts` are the single source of truth and must match the
  SQLite `CHECK` constraints (ARCHITECTURE.md §6.1).
- Development data (SQLite database, logs, models) lives in `%LOCALAPPDATA%\CompIntel-dev`,
  never inside the repository.
