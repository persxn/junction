import { z } from 'zod';

import { Action, OwnershipRule, RoleKey } from './permissions.js';

/**
 * The `/auth` and `/me` DTOs (ARCHITECTURE.md §4.12, §10, ADR-0010, ADR-0017).
 *
 * The session token appears in exactly one response — the one that mints it —
 * and travels in `Authorization: Bearer` from then on. It is never in a URL,
 * never in a cookie, and the UI keeps it in memory only (§4.12).
 */

/** Which kind of client a session belongs to (§6.2 `sessions.client_kind`). */
export const CLIENT_KINDS = ['DESKTOP', 'WEB'] as const;
export const ClientKind = z.enum(CLIENT_KINDS);
export type ClientKind = z.infer<typeof ClientKind>;

/** `users.status` (§6.2 Identity & access). */
export const USER_STATUSES = ['ACTIVE', 'DISABLED'] as const;
export const UserStatus = z.enum(USER_STATUSES);
export type UserStatus = z.infer<typeof UserStatus>;

/**
 * Passwords are only ever bounded here, never judged: a strength policy belongs
 * to the setup wizard (WP-07b). The upper bound is a denial-of-service guard —
 * Argon2id will happily spend a second on a megabyte of input.
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 256;
const Password = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);

export const LoginRequest = z.object({
  /** The login identifier (§6.2 `users.email`), compared case-insensitively. */
  email: z.email().max(320),
  /** Not `Password`: an old short password must still be able to sign in. */
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  clientKind: ClientKind.default('DESKTOP'),
  /** Free text for the sessions list, e.g. the machine name. */
  clientLabel: z.string().max(120).optional(),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

/** The signed-in person, as every screen needs them. */
export const AuthUser = z.object({
  id: z.string().min(1),
  email: z.string().min(1),
  displayName: z.string().min(1),
  departmentId: z.string().min(1).nullable(),
  status: UserStatus,
  /** True until the forced first-login change is done (ruling R38). */
  mustChangePassword: z.boolean(),
});
export type AuthUser = z.infer<typeof AuthUser>;

/** One row of `/me/permissions`; the UI hides controls with it (§10.1). */
export const PermissionEntry = z.object({
  action: Action,
  /** `ALWAYS` may be shown outright; the rest still need the server's answer. */
  rule: OwnershipRule,
});
export type PermissionEntry = z.infer<typeof PermissionEntry>;

/** When this session stops being usable (ruling R33). */
export const SessionExpiry = z.object({
  /** Moved forward by activity, at most once a minute. */
  idleExpiresAt: z.iso.datetime({ offset: true }),
  /** 12 hours after it was created; never extended. */
  absoluteExpiresAt: z.iso.datetime({ offset: true }),
  /** Minutes of inactivity the UI locks itself after (`auth.autoLockMinutes`). */
  autoLockMinutes: z
    .int()
    .min(1)
    .max(24 * 60),
});
export type SessionExpiry = z.infer<typeof SessionExpiry>;

/** `GET /me` — everything the shell needs to render for this person. */
export const MeResponse = z.object({
  user: AuthUser,
  roles: z.array(RoleKey),
  permissions: z.array(PermissionEntry),
  session: SessionExpiry,
});
export type MeResponse = z.infer<typeof MeResponse>;

/** `GET /me/permissions` — the cosmetic list on its own, for a cheap refresh. */
export const PermissionsResponse = z.object({
  permissions: z.array(PermissionEntry),
});
export type PermissionsResponse = z.infer<typeof PermissionsResponse>;

/**
 * `POST /auth/login`. The only response that ever carries the token; from here
 * on the client sends it back in `Authorization` and never stores it.
 */
export const LoginResponse = MeResponse.extend({
  token: z.string().min(1),
});
export type LoginResponse = z.infer<typeof LoginResponse>;

/**
 * `POST /auth/change-password`. The current password is required even during a
 * forced change: the person at the keyboard has to be the one who signed in.
 */
export const ChangePasswordRequest = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  newPassword: Password,
});
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequest>;

/** `POST /auth/unlock` — re-verifies the password and extends the same session (R37). */
export const UnlockRequest = z.object({
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});
export type UnlockRequest = z.infer<typeof UnlockRequest>;

/** What `/auth/logout`, `/auth/unlock` and `/auth/change-password` answer with. */
export const SessionResponse = z.object({
  session: SessionExpiry.nullable(),
});
export type SessionResponse = z.infer<typeof SessionResponse>;

/**
 * The kinds of thing `/api/v1/stream` pushes (ruling R36). Payloads carry ids
 * and counts, never names or anything else user-identifying: the stream is the
 * one place the backend talks without being asked.
 */
export const STREAM_EVENT_TYPES = [
  /** Sent once when the stream opens, so the client knows it is live. */
  'stream.ready',
  /** A domain changed; the UI invalidates that query key. */
  'data.invalidated',
  /** A scrape or import moved (WP-09a fills this in). */
  'job.progress',
  /**
   * A source's run ended, however it ended (ruling R86):
   * `{ sourceKey, outcome, finishedAt }`. The freshness pill invalidates on it,
   * which is what lets it stop polling every minute.
   */
  'source.run.finished',
  /** A notification was raised for this user (WP-23). */
  'notification.created',
] as const;
export const StreamEventType = z.enum(STREAM_EVENT_TYPES);
export type StreamEventType = z.infer<typeof StreamEventType>;

export const StreamEvent = z.object({
  /** Monotonic within one backend process; the `Last-Event-ID` cursor (R36). */
  id: z.int().min(1),
  type: StreamEventType,
  payload: z.record(z.string(), z.unknown()),
});
export type StreamEvent = z.infer<typeof StreamEvent>;
