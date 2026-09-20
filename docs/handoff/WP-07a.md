# WORKER REPORT: WP-07a — auth core

**Status: DONE**

## Summary

Accounts, Argon2id, opaque sessions, the R34 lockout ladder, the policy module driven by the contracts
matrix, the append-only audit chain and authenticated SSE — backend, contracts and UI. Built across two
sessions; this one finished the UI tests, the acceptance run and this report. `pnpm verify` is green at
**1607 tests** (1347 node + 260 desktop). A manual run of the built exe found and fixed a real bug: the SSE
route wrote its response head straight to the socket and dropped the CORS headers with it, so the WebView
blocked every stream and the app sat permanently on "Live updates unavailable".

## Files changed (paths only)

- `packages/contracts/src/`: `permissions.ts`, `permissions.test.ts`, `auth.ts`, `auth.test.ts`,
  `errors.ts`, `errors.test.ts`, `enums.ts`, `index.ts`
- `apps/backend/migrations/`: `0002_wet_black_crow.sql`, `0003_audit_append_only_and_role_seed.sql`, `meta/`
- `apps/backend/src/db/schema/`: `identity.ts`, `organization.ts`, `audit.ts`, `index.ts`; `db/migrations.test.ts`
- `apps/backend/src/modules/auth/`: `password.ts`, `argon2-binding.ts`, `tokens.ts`, `throttle.ts`,
  `repository.ts`, `service.ts`, `policy.ts`, `errors.ts` + `password/tokens/throttle/policy/service/
  service.sessions` tests
- `apps/backend/src/platform/`: `audit.ts`, `settings.ts`, `authn.ts`, `stream.ts`, `resources.ts` (+ tests)
- `apps/backend/src/routes/`: `auth.ts`, `me.ts`, `stream.ts`, `system.ts` (+ `auth.test.ts`, `stream.test.ts`)
- `apps/backend/src/testing/`: `auth.ts`, `auth-server.ts`, `harness.ts`, `database.ts`
- `apps/backend/src/tools/`: `argon-cost.ts`, `seed-dev-user.ts`, `bundle.ts`, `smoke-bundle.ts`;
  `apps/backend/package.json`, `src/app.ts`, `src/main.ts`
- `apps/desktop/src/api/`: `auth.ts`, `stream.ts`(+test), `use-live-updates.ts`(+test), `client.ts`(+test)
- `apps/desktop/src/auth/`: `auth-context.tsx`, `CredentialScreen.tsx`, `AuthScreens.tsx`,
  `auth-flow.test.tsx`, `auth-lock.test.tsx`; `src/lib/use-idle-timer.ts`
- `apps/desktop/src/app/`: `App.tsx`, `router.tsx`, `nav.ts`, `NavRail.tsx`, `UserMenu.tsx`,
  `AppShell.test.tsx`; `src/testing/`: `render.tsx`, `auth.tsx`, `fake-api.ts`; `src/shell/backend.ts`(+test)
- `apps/desktop/src-tauri/src/`: `commands.rs`, `loopback.rs`
- `docs/PROGRESS.md`, `docs/handoff/WP-07a.md`

## Tests / commands & results

- `pnpm verify` — **green. 1607 tests** (1347 node + 260 desktop), 58 files. Format, lint, typecheck clean.
- `pnpm --filter @compintel/backend smoke:bundle` — **PASSED**, including `/auth/login → 401
  AUTH_INVALID_CREDENTIALS`, which proves the Argon2id addon loaded from `native\` (R17).
- `pnpm --filter @compintel/desktop build` and `tauri:build` — both succeeded (exe rebuilt after the SSE fix).
- `pnpm audit:deps` — **no known vulnerabilities**.
- **Argon2id cost on this machine** (`argon:cost`, median of 5): m=19 MiB/t=2 → **13.7 ms** (§4.12's floor);
  **m=128 MiB/t=6 → 322–409 ms across runs ← chosen**; m=256 MiB/t=3 → 357 ms.
- Rust (R19): unchanged this session — `cargo test` 49 green, `clippy -D warnings` and `fmt --check` clean
  when `src-tauri` was last touched.

### Manual acceptance — how I checked

1. `pnpm --filter @compintel/backend seed:dev` created `admin@compintel.local` (ADMINISTRATOR) and
   `professor@compintel.local` (PROFESSOR), both `mustChangePassword`. A second run left them alone.
2. Against a `--dev` backend on the real data dir, over loopback with the real client secret: login →
   `/me/permissions` **403 AUTH_PASSWORD_CHANGE_REQUIRED** (R38) → change-password → `/me` clean; unlock with
   the right password extends the session and **the token held before the lock still works** (R37); unlock with
   the wrong one 401; professor holds **none** of the 8 admin actions; wrong password 401; no session 401;
   logout then `/me` 401.
3. Reading `app.db` afterwards: 14 `audit_log` rows covering login.succeeded/failed, logout, unlock,
   unlock.failed and password.changed; `prev_hash` chains from the 64-zero genesis in id order; **no password
   anywhere in the log**; a direct `UPDATE` and `DELETE` are both refused — "audit_log is append-only".
4. **The built exe**, driven at the keyboard with screenshots into the session scratchpad (never the repo):
   login screen → sign in as the admin → shell with the full **ADMIN** rail section and "Dev Administrator" in
   the top bar → user menu → **Lock** → "CompIntel is locked" → **Unlock** with the same password → shell back,
   no second login. Signed out, signed in as the professor: the ADMIN section is **gone**. "Exit completely"
   left no `compintel.exe` and no `node` behind. The backend log shows one `GET /api/v1/stream 200` held open
   for 39.5 s — the SSE connection lasting the whole session.

## Deviations from the prompt (why)

- **A bug fixed outside the listed tasks.** `routes/stream.ts` used `reply.raw.writeHead(200, {...})`, which
  bypasses every header Fastify had queued — including `@fastify/cors`'s `Access-Control-Allow-Origin`. The
  preflight passed, the response was then blocked by the WebView, and the client saw a stream that dropped the
  moment it opened: the app polled instead and showed "Live updates unavailable" for ever. The queued headers
  are now carried over, and `routes/stream.test.ts` asserts the header on the real socket (it fails without
  the fix). Found only because the acceptance run looked at the screen.
- **`pnpm lint` was failing when this session started** (14 errors across the previous session's UI files:
  refs written during render in `use-idle-timer.ts` and `use-live-updates.ts`, dot-notation, `only-throw-error`
  on TanStack's `redirect`). All fixed; the two ref writes moved into effects, which is a behaviour-preserving
  but real change to those hooks.
- **`service.test.ts` was 418 lines**, over CLAUDE.md's 400. Split into `service.test.ts` (signing in, R34) and
  `service.sessions.test.ts` (R33/R37/R38), with the shared harness helpers moved into `testing/auth.ts`.
  `apps/desktop/src-tauri/src/supervisor.rs` is still 565 lines from WP-05a — left alone, flagged here.

## Minor decisions made

- Test harness: `src/testing/auth.tsx` supplies a stubbed `AuthView` through an exported `AuthContext`, and
  `renderApp(path, { roles })` wraps it, so a rail test is not also a login test. `createAppRouter` now takes
  the router context, because `beforeLoad` runs on the first `load()`, before any provider can update it.
- `App.tsx` exports `SessionGate` (provider + screen chooser) so the flow tests mount the real `AuthProvider`
  against a stand-in API (`testing/fake-api.ts`) without faking the shell's IPC.
- The WP-06 test `does not make an admin screen reachable by typing its URL` no longer makes sense now that
  admin routes exist; it became "a professor who types an admin URL is sent back to the dashboard", plus a
  separate not-found test on an unknown path.
- `seed:dev` takes the data-dir lock, so CompIntel must be closed before it runs, and it skips accounts that
  already exist rather than resetting a password.
- Fake timers in the desktop tests need `{ shouldAdvanceTime: true }`, otherwise Testing Library's `waitFor`
  polls on a clock only the test can move and every assertion hangs.

## New dependencies

- **`@node-rs/argon2@2.2.1`** (added to `@compintel/backend` by the first WP-07a session) — the Argon2id
  implementation §4.12 and ADR-0010 require. Prebuilt addon, no compiler needed; it ships in the bundle as
  `native\argon2.node` per R17. Measured in WP-03a's probe before it was adopted.
- Nothing added this session.

## Known issues / tech debt

- `seed-dev-user.ts` is a stopgap: **WP-07b's setup wizard replaces it and the file should be deleted then.**
- No password-strength policy beyond `PASSWORD_MIN_LENGTH = 12`; WP-07b's wizard owns it.
- `supervisor.rs` is 565 lines (WP-05a), over the 400-line rule.
- The stream's reconnect ladder and R30 degradation are proven by unit tests and by one long-lived connection
  in the real app; a real network drop mid-session has not been exercised by hand.

## Questions for the architect

1. **`/system/shutdown` stays public in host mode.** §10.3 says only `/health` and `/auth/login` work without a
   session, but the shell's "Exit completely" must work before anyone signs in, and the per-spawn client secret
   already proves the caller is our shell. It is in `publicPaths()` in `platform/authn.ts` with a comment; in
   server mode it needs an admin session. **Please confirm.**
2. **Argon2id needs per-host calibration.** §4.12's floor costs 13.7 ms here; 128 MiB/t=6 gives 322–409 ms on
   this Ryzen 7 5700, but the pilot target is an 8 GB machine that could take 2–3× longer. Should the setup
   wizard calibrate at first run (like A18's GPU benchmark) instead of shipping fixed numbers?
3. **Admin routes are now registered** behind a `beforeLoad` guard driven by the router context, which closes
   WP-06's question 4. Please confirm that reading.
4. **`audit_log` ordering** relies on UUIDv7 keys sorting in insertion order and on one process writing;
   `append()` takes an `IMMEDIATE` transaction. Is that enough, or should there be an explicit sequence column?
5. A **stub authenticator** was added to `testing/harness.ts` (`stubAuth`, `TEST_SESSION_TOKEN`) so the
   WP-04a/04b tests that use fixture routes still test error shapes and logging rather than all asserting 401.

## Files the architect should review (most important first)

1. `apps/backend/src/routes/stream.ts` — the raw-head/CORS fix, and why SSE cannot go through the serializer.
2. `packages/contracts/src/permissions.ts` — the single source for §10.2 (R32).
3. `apps/backend/src/platform/audit.ts` — the R35 hash chain and `verifyChain`.
4. `apps/desktop/src/auth/auth-context.tsx` — the memory-only token and the four-state machine.
5. `apps/backend/src/tools/seed-dev-user.ts` — the stopgap WP-07b must delete.

## Suggested next step

**WP-07b — first-run setup wizard and user administration**: it owns the first ADMINISTRATOR account, the
password policy, invitations and the `/admin/users` screen the rail already links to, and it retires
`seed:dev`.
