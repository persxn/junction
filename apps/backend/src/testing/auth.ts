import type { RoleKey } from '@compintel/contracts';
import { afterEach } from 'vitest';

import { AppError } from '../platform/errors.js';
import { hashPassword } from '../modules/auth/password.js';
import { AuthRepository } from '../modules/auth/repository.js';
import { AuthService } from '../modules/auth/service.js';
import { LoginRateLimiter } from '../modules/auth/throttle.js';
import { AuditLog } from '../platform/audit.js';
import { SettingsStore } from '../platform/settings.js';
import type { UserRow } from '../db/schema/index.js';
import { CHEAP_ARGON2, openMigratedDatabase, type MigratedDatabase } from './database.js';

/**
 * A real database, a real service, and a clock the test owns.
 *
 * Every time-dependent rule in §4.12 — the lockout ladder, idle and absolute
 * expiry, the 60-second refresh window — is tested by moving this clock, never
 * by waiting. A suite that waits is a suite that either takes five minutes or
 * quietly stops testing the interesting case.
 */

/** A clock the test moves by hand. */
export class TestClock {
  #now: number;

  constructor(start = Date.UTC(2026, 8, 20, 9, 0, 0)) {
    this.#now = start;
  }

  now = (): number => this.#now;

  advanceMs(ms: number): void {
    this.#now += ms;
  }

  advanceMinutes(minutes: number): void {
    this.advanceMs(minutes * 60_000);
  }

  set(ms: number): void {
    this.#now = ms;
  }
}

export interface SeedUser {
  readonly email: string;
  readonly password: string;
  readonly displayName?: string;
  readonly roles?: readonly RoleKey[];
  readonly mustChangePassword?: boolean;
}

export interface AuthHarness {
  readonly database: MigratedDatabase;
  readonly repository: AuthRepository;
  readonly settings: SettingsStore;
  readonly audit: AuditLog;
  readonly service: AuthService;
  readonly clock: TestClock;
  readonly rateLimiter: LoginRateLimiter;
  /** Creates an account with a cheaply-hashed password (see `CHEAP_ARGON2`). */
  seed(user: SeedUser): Promise<UserRow>;
  close(): void;
}

export interface AuthHarnessOptions {
  readonly clock?: TestClock;
  readonly rateLimiter?: LoginRateLimiter;
  /** Fixed tokens, so a test can assert which one was handed out. */
  readonly random?: (size: number) => Buffer;
}

export function createAuthHarness(options: AuthHarnessOptions = {}): AuthHarness {
  const database = openMigratedDatabase(undefined, 'auth');
  const clock = options.clock ?? new TestClock();
  const repository = new AuthRepository(database.db, { now: clock.now });
  const settings = new SettingsStore(database.db, { now: clock.now });
  const audit = new AuditLog(database.db, { now: clock.now });
  const rateLimiter = options.rateLimiter ?? new LoginRateLimiter({ now: clock.now });
  const service = new AuthService({
    repository,
    settings,
    audit,
    now: clock.now,
    rateLimiter,
    ...(options.random === undefined ? {} : { random: options.random }),
  });

  return {
    database,
    repository,
    settings,
    audit,
    service,
    clock,
    rateLimiter,
    seed: async (user: SeedUser): Promise<UserRow> =>
      repository.createUser({
        email: user.email,
        displayName: user.displayName ?? user.email,
        passwordHash: await hashPassword(user.password, CHEAP_ARGON2),
        roles: user.roles ?? ['PROFESSOR'],
        ...(user.mustChangePassword === undefined
          ? {}
          : { mustChangePassword: user.mustChangePassword }),
      }),
    close: () => {
      database.close();
    },
  };
}

/** The account every auth suite signs in as. */
export const TEST_EMAIL = 'professor@example.edu';
export const TEST_PASSWORD = 'correct horse battery staple';

/**
 * A harness factory that also closes whatever it made.
 *
 * Called once at the top of a suite: it registers the `afterEach` itself, so a
 * file split in two does not have to copy the bookkeeping along with the tests.
 */
export function seedingHarness(): (
  options?: AuthHarnessOptions,
  seed?: Partial<SeedUser>,
) => Promise<AuthHarness> {
  let harness: AuthHarness | undefined;
  afterEach(() => {
    harness?.close();
    harness = undefined;
  });
  return async (options = {}, seed = {}) => {
    harness = createAuthHarness(options);
    await harness.seed({ email: TEST_EMAIL, password: TEST_PASSWORD, ...seed });
    return harness;
  };
}

/** The error code an `AppError` carries, or a readable complaint if it is not one. */
export function codeOf(error: unknown): string {
  return error instanceof AppError ? error.code : `not an AppError: ${String(error)}`;
}

/** Awaits a call that must fail and hands back the error it threw. */
export async function failure(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (cause) {
    return cause as AppError;
  }
  throw new Error('expected the call to fail, but it resolved');
}
