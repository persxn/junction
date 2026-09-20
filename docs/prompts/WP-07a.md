WP-07a — Auth core: accounts, Argon2id, sessions, lockout, auto-lock, policy module, append-only audit, authenticated SSE

Fresh session. Read ONLY: docs/PROGRESS.md · docs/handoff/WP-06.md · docs/handoff/WP-04b.md ·
docs/adr/ADR-0010-auth-local-accounts.md · docs/adr/ADR-0017-connection-security-sse.md ·
docs/ARCHITECTURE.md §4.4, §4.12, §6.1, §6.2 ("Organization & configuration", "Identity & access" and
"Audit & system" tables only), §10 (all of it), §15, §17 ·
packages/contracts/src/*.ts · apps/backend/src/{app.ts,main.ts,platform/*.ts,db/schema/*.ts,routes/*.ts} ·
apps/desktop/src/api/**.
Find the §6.2 tables by searching for "#### Identity & access". Do NOT read docs/research/* or the Rust shell
beyond apps/desktop/src-tauri/src/{commands.rs,loopback.rs}.

STEP 0 — Record the architect's rulings (docs only, first commit "docs: rulings v1.1.4"):
a) Version line → "**Version:** 1.1.4"; changelog row
   "| 1.1.4 | 20 Sep 2026 | Rulings R32–R38 after WP-06; auth decisions for WP-07a (see §21). |"
b) Append to the §21 table:
| R32 Permission matrix | Q5 is closed: the §10.2 matrix is the MVP matrix. `packages/contracts/src/permissions.ts` is the single source — an Action enum, the role→action map for ADMINISTRATOR and PROFESSOR, and named ownership predicates. A user may hold both roles. The UI only hides controls (§10.1). | §10.1, §10.2, Q5 |
| R33 Sessions | Opaque 256-bit token, SHA-256 hashed at rest, never logged. Idle expiry from setting `auth.autoLockMinutes` (default 15), absolute 12 h. `last_seen_at`/`idle_expires_at` are refreshed at most once every 60 s. Expired or revoked → 401 `AUTH_SESSION_EXPIRED`. | §4.12, §10.5 |
| R34 Login throttling | Per user: 5 consecutive failures → `locked_until` = now + 5 min, then 10, 20, 40, capped at 60 min. While locked, even a correct password is refused and the counter is untouched; a success resets both. Plus a process-wide limit of 10 login attempts/minute. Failures are audited without the password. | §4.12, §10.3 |
| R35 Audit chain | `prev_hash` is the previous row's `hash`; genesis is 64 zeros. `hash` = SHA-256 over a canonical (sorted-key, no-whitespace) JSON of id, occurred_at, actor_kind, actor_user_id, action, entity_kind, entity_id, summary, diff_json, request_id, prev_hash. SQLite triggers reject UPDATE and DELETE. A `verifyChain()` helper ships with it. | §6.2 |
| R36 SSE | `/api/v1/stream` per ADR-0017: `fetch` + ReadableStream, event ids from one monotonic counter, `Last-Event-ID` replayed from an in-memory ring buffer (last 200 events or 5 minutes, whichever is smaller), a comment heartbeat every 15 s, and the stream registered as a **`streams`**-phase shutdown hook (R14). Nothing user-identifying in an event body beyond ids. | ADR-0017, R14 |
| R37 Auto-lock | Enforced server-side by `idle_expires_at`; the lock screen is cosmetic. `POST /auth/unlock` re-verifies the password and extends the *same* session, so the token the UI holds in memory stays valid. | §10.5 |
| R38 Forced password change | `must_change_password` lets login succeed but every route except `/auth/change-password`, `/auth/logout` and `/me` answers 403 `AUTH_PASSWORD_CHANGE_REQUIRED`. | §4.12 |
c) PROGRESS.md "Current": next WP is WP-07b; roadmap 13 done, 33 remaining.

BUILD:
1. contracts — `permissions.ts` per R32 (Action enum, role map, ownership predicate names, `can()` shape) and
   `auth.ts` (LoginRequest/Response, MeResponse {user, roles, permissions[], session {idleExpiresAt,
   absoluteExpiresAt}}, ChangePasswordRequest, UnlockRequest, StreamEvent {id, type, payload}). Add the `AUTH_`
   ErrorCode list per R12: AUTH_INVALID_CREDENTIALS, AUTH_ACCOUNT_LOCKED, AUTH_ACCOUNT_DISABLED,
   AUTH_SESSION_EXPIRED, AUTH_PASSWORD_CHANGE_REQUIRED, AUTH_RECOVERY_INVALID. Tests for each schema.
2. Migration 0002 — the identity and organization core, so WP-07b's wizard has tables to fill:
   `organizations`, `departments`, `campuses`, `settings`, `users`, `roles` (seeded ADMINISTRATOR, PROFESSOR),
   `user_roles`, `sessions`, `audit_log` + its two reject triggers. Columns exactly as §6.2; §6.1 conventions
   (UUIDv7 TEXT keys, INTEGER ms timestamps, TEXT enums with CHECKs generated from the contracts lists,
   `version` on `users`). Triggers and any index FTS-style work go in a `--custom` migration; `drizzle-kit push`
   stays banned. Remember `pnpm typecheck` before `db:generate` when a schema file imports contracts.
3. `src/modules/auth/` — Argon2id via @node-rs/argon2 (m ≥ 19 MiB, t = 2, p = 1; measure the cost on this
   machine and report it, target 250–500 ms), a `hashPassword`/`verifyPassword` pair, session issue/verify/
   revoke/extend per R33 and R37, and the R34 throttle. Every clock and every random source injectable.
4. `src/modules/auth/policy.ts` — `can(user, action, resource?)` and `assertCan(...)` → 403 FORBIDDEN, driven
   entirely by the contracts map (R32). Application services call `assertCan`; routes never decide.
5. `src/platform/audit.ts` — append-only writer implementing R35, with `actorKind` USER|SYSTEM|SCHEDULER|AI,
   the request id threaded through, `diff_json` limited to changed fields and PII-minimised, and `verifyChain()`.
   Wire it into every auth action (login ok/failed, logout, unlock, password change).
6. Routes under `/api/v1` (preHandler order per R18: CORS → host/secret → session → policy):
   `POST /auth/login` · `POST /auth/logout` · `POST /auth/unlock` · `POST /auth/change-password` ·
   `GET /me` · `GET /me/permissions` · `GET /stream`. Per §10.3 and ADR-0017 only `/health`, `/auth/login` and
   `/system/client-log` work without a session — everything else, including `/stream`, requires one.
   `/system/client-log` per ruling A19 (client secret, no session, ≤ 8 KB, 30/min) if it does not exist yet.
7. SSE server per R36, plus the ~100-line in-house client in `apps/desktop/src/api/stream.ts`: fetch +
   ReadableStream, the same two headers, reconnect with backoff and `Last-Event-ID`, and **R30's degradation** —
   if the stream cannot be opened (Local Network Access, the shell proxy), fall back to polling `/me` every 30 s
   and surface "live updates unavailable" through the WP-06 toast/banner rather than failing.
8. Extend the shell's `backend_get` to forward an `Authorization` header (R27), keeping the GET-only,
   `/api/v1/`-prefixed allowlist exactly as it is, with a test that a non-GET or off-prefix path is still refused.
   This touches src-tauri → R19 applies: run and report `cargo test`, `clippy -D warnings`, `fmt --check`.
9. UI (apps/desktop): a login screen, the lock screen, a forced-password-change screen, sign-out and Lock in the
   user menu, the admin rail items revealed by the real permissions from `/me`, an idle timer that locks the UI
   at `auth.autoLockMinutes` (the server is the authority), and the token kept **in memory only** (§4.12 — never
   localStorage, never a cookie). Use WP-06's API client, toasts and states; add no new UI dependency without
   justifying it.
10. The bundle carries argon2's prebuilt `.node` under `native\` (R17) and `smoke:bundle` still passes.

TESTS (all in pnpm verify):
- **policy matrix: every action × role × ownership** (the §19 acceptance criterion) driven off the contracts
  map, so a new action without a decision fails the suite; plus API-level 401/403 shape tests.
- password hashing (a wrong password fails, the hash is not the password, parameters are the R34/§4.12 ones) and
  the measured cost reported.
- login: success, wrong password, disabled account, the R34 lockout ladder with an injected clock, the
  process-wide rate limit, and that a correct password during lockout is still refused.
- sessions: idle expiry, absolute expiry, the 60 s refresh window, revoke on logout, unlock extending the same
  session (R37), `must_change_password` gating (R38).
- audit: a chain over many rows verifies; a tampered row fails `verifyChain()`; UPDATE and DELETE are rejected by
  the triggers; **every auth action leaves a row** (the §19 acceptance criterion); no password or token in any row.
- SSE: connect with headers, heartbeat, event ids monotonic, `Last-Event-ID` replay, 401 without a session,
  the stream closed in the `streams` phase before `server.close()`, and the client's polling degradation.
- migration: from an empty DB and from a WP-04c-era fixture DB; the seeded roles present; CHECK constraints
  reject an unknown role key or actor kind.
- UI: login → shell, wrong password message, lock screen after the idle timeout, unlock, forced change flow,
  admin items appearing only for an admin, and the token never reaching storage (assert localStorage is empty).

ACCEPTANCE: `pnpm verify` green · permission matrix green · audit rows for every auth action · `smoke:bundle`
passes · the three Rust checks reported (R19) · `pnpm audit:deps` reported · a manual launch shows login → shell
→ lock → unlock (say how you checked) · files < 400 lines.

OUT OF SCOPE: the setup wizard and user administration (WP-07b), notifications and the tray badge (WP-23),
SSO, self-service password reset, events/teams/students, the audit *viewer* (WP-30).

Finish per CLAUDE.md (verify, PROGRESS.md ≤ 10 lines and < 150 total, docs/handoff/WP-07a.md, commit
"WP-07a: auth core", print the report).
