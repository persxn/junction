import { z } from 'zod';

import { AuthUser, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './auth.js';
import { RoleKey } from './permissions.js';

/**
 * First-run setup and user administration (ARCHITECTURE.md §4.12, §6.2, §14,
 * rulings R39–R44).
 *
 * The wizard asks for everything the application cannot invent: who the
 * institution is, where it is, who the first administrator is, the address
 * scrapers identify themselves with (§7.2) and where encrypted backups go. It
 * runs once; after that `POST /setup/complete` is refused for ever (R40).
 */

/** Passphrases and passwords share the length bounds, not the meaning (R42). */
export const PASSPHRASE_MIN_LENGTH = 12;

const Password = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);

/**
 * `GET /api/v1/setup/status` — the only thing a fresh install can ask for.
 *
 * The flags are separate rather than one boolean because a half-written install
 * is worth naming even though R40 makes it impossible: if one ever appears, the
 * status says which half.
 */
export const SetupStatus = z.object({
  /** True while the R39 gate is closed; the UI shows the wizard and nothing else. */
  required: z.boolean(),
  hasAdmin: z.boolean(),
  hasOrganization: z.boolean(),
  hasBackupKey: z.boolean(),
});
export type SetupStatus = z.infer<typeof SetupStatus>;

export const OrganizationInput = z.object({
  name: z.string().trim().min(2).max(160),
  /** The short form used in the window title and exports, e.g. "NIT Trichy". */
  shortName: z.string().trim().min(1).max(40).optional(),
});
export type OrganizationInput = z.infer<typeof OrganizationInput>;

export const DepartmentInput = z.object({
  name: z.string().trim().min(2).max(160),
  /** The institution's own code, e.g. "CSE". Unique per organization (§6.2). */
  code: z.string().trim().min(1).max(20).optional(),
});
export type DepartmentInput = z.infer<typeof DepartmentInput>;

/**
 * The primary campus. Distances in Discover are measured from here (§7.4), so
 * the coordinates are required rather than optional — this is the answer to Q3,
 * collected at runtime instead of hard-coded.
 */
export const CampusInput = z.object({
  name: z.string().trim().min(2).max(160),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});
export type CampusInput = z.infer<typeof CampusInput>;

export const AdminInput = z.object({
  email: z.email().max(320),
  displayName: z.string().trim().min(2).max(120),
  /** Chosen by the person at the keyboard, so `must_change_password` stays false. */
  password: Password,
});
export type AdminInput = z.infer<typeof AdminInput>;

/** `POST /api/v1/setup/complete` — everything, in one request, applied in one transaction (R40). */
export const SetupRequest = z.object({
  organization: OrganizationInput,
  department: DepartmentInput,
  campus: CampusInput,
  admin: AdminInput,
  /** §7.2: every scraper request carries this address; no scraping before setup. */
  scraperContactEmail: z.email().max(320),
  /** An absolute path the user picked in the native dialog (R43). */
  backupDir: z.string().min(1).max(4096),
  /** Encrypts the age identity and is never stored anywhere (R42). */
  backupPassphrase: z.string().min(PASSPHRASE_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
});
export type SetupRequest = z.infer<typeof SetupRequest>;

/**
 * What setup hands back, once, and never again.
 *
 * `recoveryCode` is stored only as an Argon2id hash (R41); `recoveryFile` is the
 * text the UI writes to disk through the shell. Both are shown on the last step
 * and cannot be recovered afterwards, which is why that step forces an export.
 */
export const SetupResult = z.object({
  recoveryCode: z.string().min(1),
  /** Suggested file name, e.g. `compintel-recovery-20260920.txt` (R42). */
  recoveryFileName: z.string().min(1),
  recoveryFile: z.string().min(1),
});
export type SetupResult = z.infer<typeof SetupResult>;

/** `POST /api/v1/setup/check-path` — is this folder usable for backups (R43)? */
export const PathCheckRequest = z.object({
  path: z.string().min(1).max(4096),
});
export type PathCheckRequest = z.infer<typeof PathCheckRequest>;

/** Why a folder was refused. The UI maps each to a sentence, never a raw errno. */
export const PATH_CHECK_REASONS = [
  'MISSING',
  'NOT_A_DIRECTORY',
  'NOT_WRITABLE',
  'INSIDE_DATA_DIR',
  'LOW_SPACE',
] as const;
export const PathCheckReason = z.enum(PATH_CHECK_REASONS);
export type PathCheckReason = z.infer<typeof PathCheckReason>;

export const PathCheckResult = z.object({
  ok: z.boolean(),
  reason: PathCheckReason.optional(),
  /** Present whenever the free space could be read, ok or not. */
  freeBytes: z.number().int().nonnegative().optional(),
  /** The path as the backend resolved it, which is what would be stored. */
  resolvedPath: z.string().min(1),
});
export type PathCheckResult = z.infer<typeof PathCheckResult>;

/* ------------------------------------------------------------------ *
 * User administration (§10.2 `user.manage`)
 * ------------------------------------------------------------------ */

/** One row of `GET /api/v1/admin/users`. Never carries a hash or a session. */
export const UserSummary = AuthUser.extend({
  roles: z.array(RoleKey),
  lastLoginAt: z.iso.datetime({ offset: true }).nullable(),
  /** Set while ruling R34's lockout is in force. */
  lockedUntil: z.iso.datetime({ offset: true }).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  /** Optimistic concurrency (§6.1); a stale value is a 409. */
  version: z.int().min(1),
});
export type UserSummary = z.infer<typeof UserSummary>;

export const UserListResponse = z.object({
  users: z.array(UserSummary),
});
export type UserListResponse = z.infer<typeof UserListResponse>;

/**
 * The admin does not choose the first password: the server generates one, shows
 * it once, and `must_change_password` makes the new user replace it (R38).
 */
export const CreateUserRequest = z.object({
  email: z.email().max(320),
  displayName: z.string().trim().min(2).max(120),
  roles: z.array(RoleKey).min(1),
  departmentId: z.string().min(1).nullable().optional(),
});
export type CreateUserRequest = z.infer<typeof CreateUserRequest>;

/** The one-time password, shown once. Also what a reset answers with. */
export const TemporaryPasswordResult = z.object({
  user: UserSummary,
  temporaryPassword: z.string().min(1),
});
export type TemporaryPasswordResult = z.infer<typeof TemporaryPasswordResult>;

export const UpdateUserRequest = z.object({
  displayName: z.string().trim().min(2).max(120).optional(),
  roles: z.array(RoleKey).min(1).optional(),
  /** The version the client last read; a mismatch is a 409 (§6.1). */
  version: z.int().min(1),
});
export type UpdateUserRequest = z.infer<typeof UpdateUserRequest>;

export const UserResponse = z.object({
  user: UserSummary,
});
export type UserResponse = z.infer<typeof UserResponse>;
