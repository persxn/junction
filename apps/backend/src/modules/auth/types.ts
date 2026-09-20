import type { ClientKind, RoleKey, UserStatus } from '@compintel/contracts';

/**
 * The auth module's vocabulary (§4.12, §10).
 *
 * These four shapes are what the rest of the backend talks to auth in: a
 * `Principal` is who is asking, an `ActiveSession` is the proof, and the two
 * login shapes are the sign-in exchange. They live apart from `service.ts`
 * because half the codebase needs the types and none of it needs the class —
 * `policy.ts`, `users/service.ts` and the session preHandler were all importing
 * the whole service module to name one interface.
 */

export interface Principal {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly departmentId: string | null;
  readonly status: UserStatus;
  readonly mustChangePassword: boolean;
  readonly roles: readonly RoleKey[];
}

export interface ActiveSession {
  readonly id: string;
  readonly user: Principal;
  readonly idleExpiresAt: number;
  readonly absoluteExpiresAt: number;
}

export interface LoginContext {
  readonly clientKind?: ClientKind;
  readonly clientLabel?: string | undefined;
  readonly requestId?: string | undefined;
}

export interface LoginResult {
  /** The one time this ever exists outside the client's memory. */
  readonly token: string;
  readonly session: ActiveSession;
}
