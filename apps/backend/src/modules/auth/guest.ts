import {
  isStudentMode,
  type GuestAvailability,
  type InstallationMode,
  type ProfileRequest,
} from '@compintel/contracts';

import { recordAudit, withAudit, type AuditLog } from '../../platform/audit.js';
import { conflict } from '../../platform/errors.js';
import type { SettingsStore } from '../../platform/settings.js';
import { nowMs, systemClock, type Clock } from '../../platform/time.js';
import { INSTALLATION_MODE } from '../installation/settings.js';
import { guestUnavailable } from './errors.js';
import { hashPassword } from './password.js';
import { assertCan } from './policy.js';
import type { ProfileRepository } from './profile-repo.js';
import { normalizeEmail, type AuthRepository } from './repository.js';
import type { AuthService } from './service.js';
import type { ActiveSession, LoginContext, LoginResult, Principal } from './types.js';

/**
 * The guest of a student install and "Create my profile" (rulings R132–R134).
 *
 * The guest is an ordinary account with no usable password. It signs in through
 * `signIn` — offered only while this is a student install and the guest is
 * ACTIVE — and it stops being offered on Myself the moment it is claimed,
 * because claiming turns it into the profile (same id, same data).
 */

export interface GuestServiceDependencies {
  readonly auth: AuthService;
  readonly users: AuthRepository;
  readonly profiles: ProfileRepository;
  readonly settings: SettingsStore;
  readonly audit: AuditLog;
  readonly clock?: Clock;
  /** The R39 gate caches "an admin exists"; R134 moves ADMINISTRATOR, so it is told. */
  readonly onAdministratorsChanged?: () => void;
}

export class GuestService {
  readonly #deps: GuestServiceDependencies;
  readonly #clock: Clock;

  constructor(deps: GuestServiceDependencies) {
    this.#deps = deps;
    this.#clock = deps.clock ?? systemClock;
  }

  mode(): InstallationMode {
    return this.#deps.settings.get(INSTALLATION_MODE);
  }

  availability(): GuestAvailability {
    const mode = this.mode();
    const guest = this.#deps.profiles.guest();
    const available = isStudentMode(mode) && guest?.status === 'ACTIVE';
    return { available, mode, automatic: available && mode === 'STUDENT_INDIVIDUAL' };
  }

  signIn(context: LoginContext = {}): LoginResult {
    const guest = this.#deps.profiles.guest();
    if (guest === undefined || !this.availability().available) throw guestUnavailable();
    return withAudit(
      this.#deps.audit,
      (result: LoginResult) => ({
        actorKind: 'USER' as const,
        actorUserId: guest.id,
        action: 'auth.guest.signed_in',
        entityKind: 'session',
        entityId: result.session.id,
        summary: 'Guest started a session',
        requestId: context.requestId ?? null,
      }),
      (): LoginResult => this.#deps.auth.issueSession(guest.id, context),
    );
  }

  /**
   * "Create my profile" from a guest session. Myself: the guest becomes the
   * profile (R133). An institution: a new profile, the first one leading, with
   * the guest's work moved across on request (R134). Either way the answer is a
   * fresh session for the profile and the guest session that asked is ended.
   */
  async createProfile(
    session: ActiveSession,
    request: ProfileRequest,
    context: LoginContext = {},
  ): Promise<LoginResult> {
    const mode = this.mode();
    const guest = this.#deps.profiles.guest();
    if (!isStudentMode(mode) || guest === undefined) throw guestUnavailable();
    if (session.user.isGuest !== true || session.user.id !== guest.id) {
      throw conflict('You already have a profile.', 'Sign out first to create another one.');
    }
    const email = normalizeEmail(request.email);
    if (this.#deps.users.findUserByEmail(email) !== undefined) {
      throw conflict(`A profile for ${email} already exists.`);
    }
    const passwordHash = await hashPassword(request.password);
    const at = nowMs(this.#clock);
    const profile = {
      email,
      displayName: request.displayName,
      passwordHash,
      departmentId: guest.departmentId,
    };

    let userId: string;
    if (mode === 'STUDENT_INDIVIDUAL') {
      withAudit(
        this.#deps.audit,
        this.#entry(guest.id, guest.id, 'user.profile.claimed', `Guest became ${email}`, {
          mode,
        }),
        () => {
          this.#deps.profiles.convertGuest(guest.id, profile, at);
        },
      );
      userId = guest.id;
    } else {
      const created = this.#deps.profiles.createProfile(
        guest.id,
        profile,
        request.takeGuestData,
        at,
      );
      recordAudit(
        this.#deps.audit,
        this.#entry(guest.id, created.userId, 'user.profile.created', `Created ${email}`, {
          mode,
          lead: created.isLead,
          movedFromGuest: created.moved,
        }),
      );
      if (created.isLead) this.#deps.onAdministratorsChanged?.();
      userId = created.userId;
    }
    this.#deps.users.revokeSession(session.id, at);
    return this.#deps.auth.issueSession(userId, context);
  }

  /** R134: the institution lead turns walk-in access on or off. */
  setEnabled(actor: Principal, enabled: boolean): GuestAvailability {
    assertCan(actor, 'user.manage');
    const guest = this.#deps.profiles.guest();
    if (this.mode() !== 'STUDENT_INSTITUTION' || guest === undefined) throw guestUnavailable();
    if (actor.id === guest.id) {
      throw conflict('The guest cannot switch itself off.', 'Create your profile first.');
    }
    withAudit(
      this.#deps.audit,
      this.#entry(actor.id, guest.id, enabled ? 'user.enabled' : 'user.disabled', '', {}),
      () => {
        this.#deps.profiles.setGuestStatus(guest.id, enabled, nowMs(this.#clock));
      },
    );
    return this.availability();
  }

  #entry(
    actorId: string,
    entityId: string,
    action: string,
    summary: string,
    diff: Record<string, unknown>,
  ): Parameters<typeof recordAudit>[1] {
    return {
      actorKind: 'USER',
      actorUserId: actorId,
      action,
      entityKind: 'user',
      entityId,
      summary:
        summary === ''
          ? `${action === 'user.enabled' ? 'Enabled' : 'Disabled'} guest access`
          : summary,
      diff,
    };
  }
}
