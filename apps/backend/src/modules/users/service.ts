import { randomInt } from 'node:crypto';

import {
  isStudentMode,
  type CreateUserRequest,
  type InstallationMode,
  type RoleKey,
  type UpdateUserRequest,
  type UserSummary,
} from '@compintel/contracts';

import { withAudit, type AuditLog } from '../../platform/audit.js';
import { AppError, conflict, notFound } from '../../platform/errors.js';
import type { AuthRepository } from '../auth/repository.js';
import { normalizeEmail } from '../auth/repository.js';
import { hashPassword } from '../auth/password.js';
import { assertCan } from '../auth/policy.js';
import type { Principal } from '../auth/types.js';
import type { UserRow } from '../../db/schema/index.js';
import type { UsersRepository, UserWithRoles } from './repository.js';
import { nowMs, systemClock, type Clock } from '../../platform/time.js';
import type { SettingsStore } from '../../platform/settings.js';
import { INSTALLATION_MODE } from '../installation/settings.js';

/**
 * User administration (§10.2 `user.manage`, roadmap WP-07b).
 *
 * Every method takes the acting principal and asks `assertCan` first: routes
 * never decide (ruling R32). The one rule that is not in the permission matrix
 * is the one that cannot be: **an installation must always keep at least one
 * usable administrator**, so the last one cannot be disabled or demoted, not
 * even by themselves.
 */

/**
 * Alphabet for generated first passwords. No `0/O`, no `1/l/I`: these are read
 * off a screen and typed into another machine, often by a third person.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

/** Long enough to clear `PASSWORD_MIN_LENGTH` with room to spare. */
const TEMPORARY_PASSWORD_LENGTH = 16;

export function generateTemporaryPassword(
  length = TEMPORARY_PASSWORD_LENGTH,
  random: (max: number) => number = randomInt,
): string {
  let out = '';
  for (let index = 0; index < length; index += 1) {
    out += ALPHABET[random(ALPHABET.length)];
  }
  return out;
}

function lastAdministrator(what: string): AppError {
  return new AppError({
    status: 409,
    code: 'CONFLICT',
    title: 'This is the last administrator',
    detail: `${what} would leave Junction with no administrator, and nobody could manage it again.`,
    hint: 'Give another account the Administrator role first.',
    retryable: false,
  });
}

/** R131: PROFESSOR belongs to department installs, STUDENT to student ones. */
function roleNotForMode(role: RoleKey): AppError {
  return new AppError({
    status: 422,
    code: 'AUTH_ROLE_NOT_FOR_MODE',
    title: `The ${role.toLowerCase()} role is not used on this install`,
    detail:
      role === 'PROFESSOR'
        ? 'A student install has students, not professors.'
        : 'A department install has professors; students are records, not accounts.',
    retryable: false,
  });
}

/** R133: "Myself" has exactly one profile — the guest that became it. */
function singleProfileInstall(): AppError {
  return new AppError({
    status: 409,
    code: 'AUTH_SINGLE_PROFILE_INSTALL',
    title: 'This install is for one person',
    detail: 'Junction was set up for one student, so it has no other accounts to add.',
    retryable: false,
  });
}

function isoOrNull(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

/** The DTO, from the two rows that make it. Never carries a hash. */
export function toSummary(entry: UserWithRoles): UserSummary {
  const { user } = entry;
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    departmentId: user.departmentId,
    status: user.status === 'DISABLED' ? 'DISABLED' : 'ACTIVE',
    mustChangePassword: user.mustChangePassword,
    roles: [...entry.roles],
    lastLoginAt: isoOrNull(user.lastLoginAt),
    lockedUntil: isoOrNull(user.lockedUntil),
    createdAt: new Date(user.createdAt).toISOString(),
    version: user.version,
  };
}

export interface UsersServiceDependencies {
  readonly repository: UsersRepository;
  readonly auth: AuthRepository;
  readonly audit: AuditLog;
  readonly clock?: Clock;
  /** WP-34: which roles fit this install (R131); absent means a department install. */
  readonly settings?: SettingsStore;
  /** Invalidates the R39 gate's cache when the admin population changes. */
  readonly onAdministratorsChanged?: () => void;
}

export interface UsersServiceContext {
  readonly actor: Principal;
  readonly requestId?: string | undefined;
}

export class UsersService {
  readonly #repository: UsersRepository;
  readonly #auth: AuthRepository;
  readonly #audit: AuditLog;
  readonly #clock: Clock;
  readonly #onAdministratorsChanged: () => void;
  readonly #settings: SettingsStore | undefined;

  constructor(dependencies: UsersServiceDependencies) {
    this.#settings = dependencies.settings;
    this.#repository = dependencies.repository;
    this.#auth = dependencies.auth;
    this.#audit = dependencies.audit;
    this.#clock = dependencies.clock ?? systemClock;
    this.#onAdministratorsChanged = dependencies.onAdministratorsChanged ?? ((): void => undefined);
  }

  list(context: UsersServiceContext): readonly UserSummary[] {
    assertCan(context.actor, 'user.manage');
    return this.#repository.list().map(toSummary);
  }

  async create(
    context: UsersServiceContext,
    request: CreateUserRequest,
  ): Promise<{ user: UserSummary; temporaryPassword: string }> {
    assertCan(context.actor, 'user.manage');
    if (this.#mode() === 'STUDENT_INDIVIDUAL') throw singleProfileInstall();
    this.#assertRolesFit(request.roles);

    const email = normalizeEmail(request.email);
    if (this.#auth.findUserByEmail(email) !== undefined) {
      throw conflict(`An account for ${email} already exists.`);
    }

    const temporaryPassword = generateTemporaryPassword();
    // Hashing is the slow, asynchronous part; the transaction below is not.
    const passwordHash = await hashPassword(temporaryPassword);
    const row = withAudit(
      this.#audit,
      (created: UserRow) => ({
        actorKind: 'USER' as const,
        actorUserId: context.actor.id,
        action: 'user.created',
        entityKind: 'user',
        entityId: created.id,
        summary: `Created the account ${email}`,
        diff: { email, displayName: request.displayName, roles: [...request.roles] },
        requestId: context.requestId ?? null,
      }),
      (): UserRow =>
        this.#auth.createUser({
          email,
          displayName: request.displayName,
          passwordHash,
          departmentId: request.departmentId ?? null,
          // Ruling R38: the admin knows this password, so the new user must replace it.
          mustChangePassword: true,
          roles: request.roles,
          createdBy: context.actor.id,
        }),
    );

    if (request.roles.includes('ADMINISTRATOR')) {
      this.#onAdministratorsChanged();
    }

    const created = this.#require(row.id);
    return { user: toSummary(created), temporaryPassword };
  }

  setEnabled(context: UsersServiceContext, userId: string, enabled: boolean): UserSummary {
    assertCan(context.actor, 'user.manage');
    const target = this.#require(userId);

    if (!enabled) {
      if (target.user.id === context.actor.id) {
        throw new AppError({
          status: 409,
          code: 'CONFLICT',
          title: 'You cannot disable your own account',
          detail: 'Ask another administrator to do it, so nobody locks themselves out by accident.',
          retryable: false,
        });
      }
      if (this.#wouldRemoveLastAdministrator(target, [])) {
        throw lastAdministrator('Disabling this account');
      }
    }

    withAudit(
      this.#audit,
      {
        actorKind: 'USER',
        actorUserId: context.actor.id,
        action: enabled ? 'user.enabled' : 'user.disabled',
        entityKind: 'user',
        entityId: userId,
        summary: `${enabled ? 'Enabled' : 'Disabled'} the account ${target.user.email}`,
        diff: { status: enabled ? 'ACTIVE' : 'DISABLED' },
        requestId: context.requestId ?? null,
      },
      () => {
        this.#repository.setStatus(userId, enabled ? 'ACTIVE' : 'DISABLED');
      },
    );
    this.#onAdministratorsChanged();
    return toSummary(this.#require(userId));
  }

  update(context: UsersServiceContext, userId: string, request: UpdateUserRequest): UserSummary {
    assertCan(context.actor, 'user.manage');
    const target = this.#require(userId);

    if (request.roles !== undefined) this.#assertRolesFit(request.roles);
    if (request.roles !== undefined && this.#wouldRemoveLastAdministrator(target, request.roles)) {
      throw lastAdministrator('Taking the Administrator role away');
    }

    const changes: { displayName?: string; roles?: readonly RoleKey[] } = {};
    if (request.displayName !== undefined) {
      changes.displayName = request.displayName;
    }
    if (request.roles !== undefined) {
      changes.roles = request.roles;
    }

    withAudit(
      this.#audit,
      {
        actorKind: 'USER',
        actorUserId: context.actor.id,
        action: 'user.updated',
        entityKind: 'user',
        entityId: userId,
        summary: `Updated the account ${target.user.email}`,
        diff: {
          ...(request.displayName === undefined ? {} : { displayName: request.displayName }),
          ...(request.roles === undefined ? {} : { roles: [...request.roles] }),
        },
        requestId: context.requestId ?? null,
      },
      () => {
        // The optimistic-concurrency check throws from inside the transaction,
        // so a losing write leaves no audit row claiming it happened.
        if (!this.#repository.update(userId, request.version, changes)) {
          throw conflict(
            'Somebody else changed this account while you were editing it. Reload and try again.',
          );
        }
      },
    );
    if (request.roles !== undefined) {
      this.#onAdministratorsChanged();
    }
    return toSummary(this.#require(userId));
  }

  async resetPassword(
    context: UsersServiceContext,
    userId: string,
  ): Promise<{ user: UserSummary; temporaryPassword: string }> {
    assertCan(context.actor, 'user.manage');
    const target = this.#require(userId);

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    withAudit(
      this.#audit,
      {
        actorKind: 'USER',
        actorUserId: context.actor.id,
        action: 'user.password.reset',
        entityKind: 'user',
        entityId: userId,
        summary: `Reset the password for ${target.user.email}`,
        // Never the password itself, generated or not.
        diff: { mustChangePassword: true },
        requestId: context.requestId ?? null,
      },
      () => {
        this.#repository.resetPassword(userId, passwordHash);
        // Whoever was signed in as this account is not any more: the password
        // they hold is dead, and a live session would outlive it (§4.12).
        this.#auth.revokeAllSessionsFor(userId, nowMs(this.#clock));
      },
    );
    return { user: toSummary(this.#require(userId)), temporaryPassword };
  }

  #require(userId: string): UserWithRoles {
    const found = this.#repository.find(userId);
    if (found === undefined) {
      throw notFound('No account with that id.');
    }
    return found;
  }

  /**
   * Would this change leave nobody able to administer the installation?
   *
   * Only asked when the target is an active administrator losing that standing;
   * in every other case the answer is trivially no.
   */
  #mode(): InstallationMode {
    return this.#settings?.get(INSTALLATION_MODE) ?? 'DEPARTMENT';
  }

  #assertRolesFit(roles: readonly RoleKey[]): void {
    const forbidden: RoleKey = isStudentMode(this.#mode()) ? 'PROFESSOR' : 'STUDENT';
    if (roles.includes(forbidden)) throw roleNotForMode(forbidden);
  }

  #wouldRemoveLastAdministrator(target: UserWithRoles, nextRoles: readonly RoleKey[]): boolean {
    const wasAdministrator =
      target.roles.includes('ADMINISTRATOR') && target.user.status === 'ACTIVE';
    if (!wasAdministrator || nextRoles.includes('ADMINISTRATOR')) {
      return false;
    }
    return this.#repository.activeAdministratorCount() <= 1;
  }
}
