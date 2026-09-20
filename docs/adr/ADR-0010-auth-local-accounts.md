# ADR-0010: Auth: local accounts, Argon2id, opaque hashed sessions, code-defined RBAC

- **Status:** Accepted (spec v1.1.6, 2026-09-20) — amended twice
- **Date:** 2026-09-20
- **Source:** ARCHITECTURE.md §1 (D-03, D-07, D-20, D-24), §4.12, §10, §21 (R33, R34, R37, R38, R47)

## Context
Admin-created local accounts with roles ADMINISTRATOR and PROFESSOR, an open-department visibility model with
ownership-based editing, no SSO in the MVP, and shared machines are possible.

## Decision
- Argon2id via `@node-rs/argon2` (prebuilt): m = 128 MiB, t = 6, p = 1 — 322–409 ms measured on the
  build machine (R17 addon path). Fixed for now; see R46 before revising.
- **Sessions (R33):** opaque 256-bit token, SHA-256 hashed at rest, never logged. Idle expiry from
  `auth.autoLockMinutes` (default 15), absolute 12 h. `last_seen_at`/`idle_expires_at` refresh at most
  once every 60 s. Expired or revoked → 401 `AUTH_SESSION_EXPIRED`. The UI keeps the token in memory
  only.
- **Login throttling and lockout (R34):** per user, 5 consecutive failures → `locked_until` = now + 5
  min, then 10, 20, 40, capped at 60 min; a correct password while locked is still refused and the
  counter untouched; a success resets both. Plus a process-wide 10 attempts/minute limit. Failures are
  audited without the password.
- **Auto-lock (R37):** enforced server-side by `idle_expires_at`; the lock screen is cosmetic.
  `POST /auth/unlock` re-verifies the password and extends the *same* session, so the in-memory token
  stays valid.
- **Forced password change (R38):** `must_change_password` lets login succeed, but every route except
  `/auth/change-password`, `/auth/logout` and `/me` answers 403 `AUTH_PASSWORD_CHANGE_REQUIRED`. The
  first-run wizard creates the first admin (with a password they chose, so this flag is off for them)
  and a one-time recovery code (ADR-0011/R41); admin-created users get it turned on.
- **`/system/shutdown` needs no session (R47):** only the per-launch client secret, so "Exit
  completely" works from the lock screen and from inside the setup wizard.
- Host mode: every request also carries the per-launch client secret. The local API binds loopback only, with a
  Host allowlist, a CORS allowlist for the Tauri origin and a strict CSP.
- RBAC defined in code (`packages/contracts/permissions.ts` + backend `policy.can/assertCan`) with
  ownership predicates, enforced in application services. The UI only hides controls.
- `AuthProvider` boundary so SSO can be added later.

## Consequences
- No self-service password reset (no email in the MVP); recovery is the one-time admin recovery code
  (ADR-0011/R41), and WP-30 is the WP that will let a locked-out admin actually use it (R45).
- The permission-matrix test covers every action × role × ownership combination.
- Fixed Argon2id parameters mean the pilot host's login latency is unverified until WP-31 measures it
  (R46) — a real but bounded risk, not a blocker, since 322–409 ms already includes headroom before it
  is user-visible.

## Alternatives considered
- Windows identity: breaks on shared PCs and accounts.
- SSO: needs internet and IT registration; later, behind `AuthProvider`.

## Amendments (v1.1)
- Header names and SSE authentication are defined in ADR-0017.

## Amendments (v1.1.6 — architect review of M0)
- Folded in R33 (sessions), R34 (login throttling), R37 (auto-lock), R38 (forced password change) and
  R47 (`/system/shutdown` exemption) above; these were self-issued while the architect was away
  (docs/handoff/M0.md) and are now reviewed and accepted as written, no changes.
- The product-owner review of Sep 2026 (M0.md §3.3.2) considered dropping Argon2id's parameters, the
  lockout ladder, the audit chain and auto-lock for the now-confirmed single-professor deployment
  (§3.1) and explicitly chose not to: this ADR is unchanged by that review.
