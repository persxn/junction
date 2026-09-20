=== WORKER REPORT: WP-03b ===
Status: DONE

Summary (<=5 lines):
pnpm workspace with TypeScript strict + project references, ESLint 10 flat config with type-checked
rules, Prettier 3, Vitest 5, and `pnpm verify` chaining all four. packages/contracts holds API_VERSION,
the five spec enums and an RFC 9457 ProblemDetails schema in zod 4, with 57 valid/invalid tests;
apps/backend consumes it over workspace:*. Verify is green in the repo and in a fresh clone installed
with --frozen-lockfile, and each of the three injected faults makes it exit 1.

Files changed (paths only):
package.json · pnpm-workspace.yaml · pnpm-lock.yaml · .npmrc · .node-version · .editorconfig
.gitattributes · .gitignore (extended) · .prettierrc.json · .prettierignore · eslint.config.js
tsconfig.base.json · tsconfig.json · vitest.config.ts · README.md
packages/contracts/{package.json,tsconfig.json,src/{version,enums,errors,index}.ts,
                    src/{version,enums,errors}.test.ts}
apps/backend/{package.json,tsconfig.json,src/index.ts,src/index.test.ts}
docs/PROGRESS.md · docs/handoff/WP-03b.md

Tests/commands & results:
  pnpm install                                 134 packages, 24 s
  pnpm verify (clean)                          EXIT 0, 6.1 s — 4 test files, 57 tests passed
  ACCEPTANCE: fresh clone
    git clone <repo> %LOCALAPPDATA%\CompIntel-dev\clone-test    EXIT 0
    pnpm install --frozen-lockfile                              EXIT 0, 1.6 s, 134 packages
    pnpm verify                                                 EXIT 0, 7.2 s, 57 tests passed
    clone deleted; CompIntel-dev is empty again
  ACCEPTANCE: injected faults (each reverted, `diff` against the backups confirms byte-identical)
    1. lint  — `export function lintBreaker(value: any)` in apps/backend/src/index.ts
         format:check PASS -> lint FAIL "@typescript-eslint/no-explicit-any"     EXIT 1
    2. type  — `export const typeBreaker: number = describeBuild().name;`
         format:check PASS, lint PASS -> tsc -b FAIL
         "apps/backend/src/index.ts(16,14): error TS2322: Type 'string' is not assignable to type 'number'."
                                                                                  EXIT 1
    3. test  — an `expect(API_VERSION).toBe('9.9.9')` case in version.test.ts
         first three stages PASS -> vitest 1 failed | 57 passed                   EXIT 1
    after reverting all three: pnpm verify                                        EXIT 0
  §4.15 budget: verify must stay under 2 min. Currently 6-7 s.

Deviations from the prompt (why):
- The prompt asks for "the latest stable TypeScript that typescript-eslint supports". That is **6.0.3,
  not 7.0.2**: typescript-eslint 8.70.0 (the only stable major) declares `typescript: >=4.8.4 <6.1.0`.
  TypeScript 7 is out until typescript-eslint ships support.
- ARCHITECTURE.md §15's last bullet also wants `pnpm audit` in verify. The prompt defines verify as
  exactly format:check && lint && typecheck && test, so audit is not wired in — see question 1.

Minor decisions made:
- `onlyBuiltDependencies: []` — **empty on purpose**. pnpm reported no ignored build scripts for this
  134-package tree, so no package needs one yet. The list lives in pnpm-workspace.yaml (pnpm 10+ home)
  with a comment requiring every future entry to be justified in the WP report that adds it.
- Prettier ignores `docs/` and `CLAUDE.md`: they are architect-owned and committed verbatim. Prettier
  reformatted CLAUDE.md on its first run; that was reverted and the ignore added.
- Test files are inside each package's composite project, so `tsc -b` type-checks them too; the cost is
  that `*.test.js` lands in dist. Nothing is published, so this is cheaper than a second tsconfig.
- vitest.config.ts aliases `@compintel/contracts` to the package **source**, so `pnpm test` works
  without a prior build while `tsc -b` still exercises the real declaration output.
- Extra strictness beyond the prompt: noUnusedLocals, noUnusedParameters, exactOptionalPropertyTypes,
  moduleDetection force. `@typescript-eslint/no-unused-vars` is configured for the `_` prefix so it
  agrees with tsconfig.
- ProblemDetails makes type/title/status/detail/instance/code required and only hint/retryable optional,
  following the prompt's `?` markers (RFC 9457 itself makes all five optional).
- Root `tsconfig.json` is a solution file (`files: []` + references); `.tsbuildinfo` goes to each dist/.
- Added a `pnpm clean` script (`tsc -b --clean`) — not requested, one line, saves manual dist deletion.

New dependencies (name@version - why):  all exact, `save-exact=true`
  Root devDependencies
    typescript@6.0.3            - latest stable within typescript-eslint's supported range
    typescript-eslint@8.70.0    - latest major; provides the type-checked rule presets
    eslint@10.11.0              - latest major, inside typescript-eslint's peer range ^10.0.0
    @eslint/js@10.0.1           - `js.configs.recommended` base ruleset for flat config
    eslint-config-prettier@10.1.8 - turns off rules Prettier owns (loaded last)
    prettier@3.9.8              - formatter, printWidth 100 + singleQuote as specified
    vitest@5.0.1                - test runner per ADR/§4.15
    @types/node@24.13.6         - Node 24 typings, matched to the pinned runtime (not the 26.x latest)
  packages/contracts
    zod@4.6.5                   - the schema library ADR-0003 mandates
  apps/backend
    @compintel/contracts@workspace:* - internal workspace link

Known issues / tech debt:
1. `pnpm audit` is not part of verify (§15 wants it). It needs the network, which would make the
   clone-test acceptance criterion non-deterministic. Needs a ruling.
2. TypeScript is held at 6.0.3 by typescript-eslint. Worth rechecking when typescript-eslint 9 lands.
3. `tools/` and `resources/` are declared in the workspace but empty, so pnpm lists 3 projects only.
4. Compiled `*.test.js` files land in each dist/ (see Minor decisions).
5. No CI: verify is run by hand. Nothing in the roadmap has asked for a pipeline yet.
6. `.gitignore` inherits a broad `bin/` and `obj/` from the WP-00 .NET section; harmless now, but it
   would silently ignore a future `bin/` directory of ours.

Questions for the architect:
1. Should `pnpm audit` join verify per §15, or run as a separate `pnpm audit:ci` so that verify stays
   offline and deterministic? I recommend the latter.
2. ProblemDetails currently requires `detail` and `instance` on every error. RFC 9457 makes both
   optional. Confirm the stricter shape before WP-04a starts emitting errors against it.
3. Does the desktop app join as `apps/desktop` with the Rust shell under `apps/desktop/src-tauri`
   (§3.4), sharing the root tsconfig/eslint setup? That decides whether the base config needs DOM libs.

Files the architect should review (<=5, most important first):
1. packages/contracts/src/errors.ts (the ProblemDetails shape — question 2)
2. packages/contracts/src/enums.ts (values transcribed from §6.2/§6.4 — worth a second pair of eyes)
3. tsconfig.base.json (strictness beyond the prompt)
4. eslint.config.js
5. package.json (scripts, engines, packageManager)

Suggested next step:
WP-04a. The scaffold is ready for Fastify: add `apps/backend` runtime dependencies, keep business logic
in `src/modules/<module>/` per §3.4, and extend contracts with the DTOs those routes need.
===
