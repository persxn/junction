import {
  PASSPHRASE_MIN_LENGTH,
  type PathCheckResult,
  type SetupRequest,
  type SetupResult,
  type SetupStatus,
} from '@compintel/contracts';

import { AppError } from '../../platform/errors.js';
import { withAudit, type AuditLog } from '../../platform/audit.js';
import { serialize, type SettingsStore } from '../../platform/settings.js';
import { AUTO_LOCK_MINUTES, RECOVERY_CODE_HASH } from '../auth/settings.js';
import {
  BACKUP_DAILY_TIME_LOCAL,
  BACKUP_DESTINATION_DIR,
  BACKUP_PRIVATE_KEY_ENCRYPTED,
  BACKUP_PUBLIC_KEY,
} from '../backup/settings.js';
import { SCRAPER_CONTACT_EMAIL } from '../org/settings.js';
import { generateBackupKeys, recoveryFileName, renderRecoveryFile } from '../backup/keys.js';
import { hashPassword } from '../auth/password.js';
import { normalizeEmail } from '../auth/repository.js';
import { checkBackupPath, type PathCheckOptions } from './paths.js';
import { generateRecoveryCode, normalizeRecoveryCode } from './recovery-code.js';
import type { SetupRepository, SetupWriteResult } from './repository.js';
import { systemClock, type Clock } from '../../platform/time.js';

/**
 * First-run setup (rulings R39–R44).
 *
 * Everything the wizard collects is validated here and then written by the
 * repository in **one** transaction, so an installation is either set up or
 * untouched — there is no state in which an organization exists but its
 * administrator does not, and therefore no state the R39 gate cannot describe.
 */

export interface SetupServiceDependencies {
  readonly repository: SetupRepository;
  readonly settings: SettingsStore;
  readonly audit: AuditLog;
  /** The process data directory: the backup folder may not live inside it (R43). */
  readonly dataDir: string;
  readonly appVersion: string;
  readonly clock?: Clock;
  readonly minFreeBytes?: number;
  /** Lowered in tests; scrypt at the real factor costs a second per call. */
  readonly scryptWorkFactor?: number;
  /**
   * Runs inside the setup transaction once the department exists — WP-20a seeds
   * the default workflow templates here (R101).
   */
  readonly onCompleted?: (departmentId: string, at: number) => void;
}

/** 409, not 401: nothing is wrong with the caller, the install is just empty. */
export function setupRequired(): AppError {
  return new AppError({
    status: 409,
    code: 'SETUP_REQUIRED',
    title: 'Junction has not been set up yet',
    detail: 'The first-run wizard has to be completed before anything else works.',
    retryable: false,
  });
}

export function setupAlreadyDone(): AppError {
  return new AppError({
    status: 409,
    code: 'SETUP_ALREADY_DONE',
    title: 'Junction is already set up',
    detail: 'An administrator already exists, so the first-run wizard cannot run again.',
    hint: 'Sign in instead. An administrator can add more accounts under Admin → Users.',
    retryable: false,
  });
}

function passphraseWeak(detail: string): AppError {
  return new AppError({
    status: 422,
    code: 'SETUP_PASSPHRASE_WEAK',
    title: 'That backup passphrase cannot be used',
    detail,
    retryable: false,
  });
}

function pathUnusable(result: PathCheckResult): AppError {
  return new AppError({
    status: 422,
    code: 'SETUP_PATH_UNUSABLE',
    title: 'That backup folder cannot be used',
    detail: `${result.resolvedPath} was refused: ${result.reason ?? 'unknown'}.`,
    retryable: false,
  });
}

export class SetupService {
  readonly #repository: SetupRepository;
  readonly #settings: SettingsStore;
  readonly #audit: AuditLog;
  readonly #dataDir: string;
  readonly #appVersion: string;
  readonly #clock: Clock;
  readonly #minFreeBytes: number | undefined;
  readonly #scryptWorkFactor: number | undefined;
  readonly #onCompleted: ((departmentId: string, at: number) => void) | undefined;

  /**
   * The gate is asked on every single request, so the answer is cached. It only
   * ever flips once, from "required" to "done", and only this class can flip it.
   */
  #administratorExists: boolean | undefined;

  constructor(dependencies: SetupServiceDependencies) {
    this.#repository = dependencies.repository;
    this.#settings = dependencies.settings;
    this.#audit = dependencies.audit;
    this.#dataDir = dependencies.dataDir;
    this.#appVersion = dependencies.appVersion;
    this.#clock = dependencies.clock ?? systemClock;
    this.#minFreeBytes = dependencies.minFreeBytes;
    this.#scryptWorkFactor = dependencies.scryptWorkFactor;
    this.#onCompleted = dependencies.onCompleted;
  }

  /** Ruling R39. Cheap: one query on the first call, a boolean after that. */
  isRequired(): boolean {
    this.#administratorExists ??= this.#repository.hasActiveAdministrator();
    return !this.#administratorExists;
  }

  /** Drops the cache; used by the tests and by anything that disables an admin. */
  invalidate(): void {
    this.#administratorExists = undefined;
  }

  status(): SetupStatus {
    const hasAdmin = !this.isRequired();
    return {
      required: !hasAdmin,
      hasAdmin,
      hasOrganization: this.#repository.organization() !== undefined,
      hasBackupKey: this.#settings.get(BACKUP_PUBLIC_KEY) !== '',
    };
  }

  checkPath(candidate: string): PathCheckResult {
    const options: PathCheckOptions = {
      dataDir: this.#dataDir,
      ...(this.#minFreeBytes === undefined ? {} : { minFreeBytes: this.#minFreeBytes }),
    };
    return checkBackupPath(candidate, options);
  }

  /**
   * The whole wizard, applied at once (R40).
   *
   * Order matters: everything that can be refused is refused before anything is
   * written, and the expensive work (two Argon2id hashes and an scrypt) happens
   * outside the transaction so the write lock is held for microseconds.
   */
  async complete(request: SetupRequest): Promise<SetupResult> {
    if (!this.isRequired()) {
      throw setupAlreadyDone();
    }

    this.#assertPassphrase(request);
    const pathCheck = this.checkPath(request.backupDir);
    if (!pathCheck.ok) {
      throw pathUnusable(pathCheck);
    }

    const recoveryCode = generateRecoveryCode();
    const [passwordHash, recoveryCodeHash, backupKeys] = await Promise.all([
      hashPassword(request.admin.password),
      hashPassword(normalizeRecoveryCode(recoveryCode)),
      this.#scryptWorkFactor === undefined
        ? generateBackupKeys(request.backupPassphrase)
        : generateBackupKeys(request.backupPassphrase, this.#scryptWorkFactor),
    ]);

    const createdAt = this.#clock.now();
    // Written through the definitions, so each value is validated by the same
    // schema a later read will use — inside R40's one transaction, which is why
    // these are rows rather than `SettingsStore.set` calls.
    const settings: [string, string][] = [
      [
        SCRAPER_CONTACT_EMAIL.key,
        serialize(SCRAPER_CONTACT_EMAIL, normalizeEmail(request.scraperContactEmail)),
      ],
      [BACKUP_PUBLIC_KEY.key, serialize(BACKUP_PUBLIC_KEY, backupKeys.publicKey)],
      [
        BACKUP_PRIVATE_KEY_ENCRYPTED.key,
        serialize(BACKUP_PRIVATE_KEY_ENCRYPTED, backupKeys.privateKeyEncrypted),
      ],
      [BACKUP_DESTINATION_DIR.key, serialize(BACKUP_DESTINATION_DIR, pathCheck.resolvedPath)],
      [
        BACKUP_DAILY_TIME_LOCAL.key,
        serialize(BACKUP_DAILY_TIME_LOCAL, BACKUP_DAILY_TIME_LOCAL.default),
      ],
      [AUTO_LOCK_MINUTES.key, serialize(AUTO_LOCK_MINUTES, AUTO_LOCK_MINUTES.default)],
      [RECOVERY_CODE_HASH.key, serialize(RECOVERY_CODE_HASH, recoveryCodeHash)],
    ];

    // R40 already puts the whole wizard in one transaction; `withAudit` puts the
    // audit row inside that same one, so an installation can never exist without
    // the row that says when it was created and by whom. Audited as the admin who
    // was just created: they are the actor, even though their own row is a
    // millisecond old.
    withAudit(
      this.#audit,
      (result: SetupWriteResult) => ({
        actorKind: 'USER' as const,
        actorUserId: result.adminUserId,
        action: 'setup.completed',
        entityKind: 'organization',
        entityId: result.organizationId,
        summary: `Junction was set up for ${request.organization.name}`,
        diff: {
          organization: request.organization.name,
          department: request.department.name,
          campus: request.campus.name,
          adminEmail: normalizeEmail(request.admin.email),
          backupDir: pathCheck.resolvedPath,
        },
      }),
      (): SetupWriteResult => {
        const written = this.#repository.completeSetup({
          organization: request.organization,
          department: request.department,
          campus: request.campus,
          admin: {
            email: normalizeEmail(request.admin.email),
            displayName: request.admin.displayName,
            passwordHash,
          },
          settings,
        });
        this.#onCompleted?.(written.departmentId, createdAt.getTime());
        return written;
      },
    );

    this.#administratorExists = true;

    return {
      recoveryCode,
      recoveryFileName: recoveryFileName(createdAt),
      recoveryFile: renderRecoveryFile({
        organizationName: request.organization.name,
        publicKey: backupKeys.publicKey,
        privateKeyEncrypted: backupKeys.privateKeyEncrypted,
        schemaVersion: this.#repository.schemaVersion(),
        appVersion: this.#appVersion,
        createdAt,
      }),
    };
  }

  /** R42's three passphrase rules. The length one is also in the schema; this is the message. */
  #assertPassphrase(request: SetupRequest): void {
    const passphrase = request.backupPassphrase;
    if (passphrase.length < PASSPHRASE_MIN_LENGTH) {
      throw passphraseWeak(
        `A backup passphrase needs at least ${String(PASSPHRASE_MIN_LENGTH)} characters.`,
      );
    }
    if (passphrase === request.admin.password) {
      throw passphraseWeak(
        'The backup passphrase must be different from your Junction password: ' +
          'one unlocks this machine, the other unlocks backups that leave it.',
      );
    }
  }
}
