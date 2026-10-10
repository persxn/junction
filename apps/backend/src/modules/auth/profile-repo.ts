import type { RoleKey } from '@compintel/contracts';

import type { DatabaseHandle } from '../../platform/db.js';
import { uuid7 } from '../../platform/ids.js';

/**
 * The SQL behind "Create my profile" (rulings R133, R134). Every method is one
 * IMMEDIATE transaction: "is this the first profile?" and "make it the lead" are
 * decided under the same write lock, so two guests claiming at once produce
 * exactly one lead.
 */

/** Personal rows that follow their owner (R134's "take what Guest made with you"). */
const PERSONAL_TABLES = [
  'event_user_state',
  'watchlist_items',
  'saved_searches',
  'user_interest_tags',
] as const;

export interface NewProfile {
  readonly email: string;
  readonly displayName: string;
  readonly passwordHash: string;
  readonly departmentId: string | null;
}

export interface CreatedProfile {
  readonly userId: string;
  readonly isLead: boolean;
  readonly moved: number;
}

export class ProfileRepository {
  readonly #db: DatabaseHandle;

  constructor(db: DatabaseHandle) {
    this.#db = db;
  }

  /** The guest row, ACTIVE or not; undefined once a Myself claim has used it up. */
  guest(): { id: string; status: string; departmentId: string | null } | undefined {
    return this.#db.raw
      .prepare(
        `SELECT id, status, department_id AS departmentId FROM users WHERE is_guest = 1 LIMIT 1`,
      )
      .get() as { id: string; status: string; departmentId: string | null } | undefined;
  }

  /** Accounts that are not the guest — profiles. */
  profileCount(): number {
    return (
      this.#db.raw.prepare(`SELECT count(*) AS n FROM users WHERE is_guest = 0`).get() as {
        n: number;
      }
    ).n;
  }

  /** R133: Myself — the guest *becomes* the profile; its id, and so its data, stays. */
  convertGuest(guestId: string, profile: NewProfile, at: number): void {
    this.#db.raw
      .transaction(() => {
        this.#db.raw
          .prepare(
            `UPDATE users SET email = ?, display_name = ?, password_hash = ?, is_guest = 0,
               must_change_password = 0, updated_at = ?, version = version + 1
             WHERE id = ? AND is_guest = 1`,
          )
          .run(profile.email, profile.displayName, profile.passwordHash, at, guestId);
      })
      .immediate();
  }

  /**
   * R134: an institution. The first profile is the lead (STUDENT + ADMINISTRATOR)
   * and the guest drops to STUDENT in the same transaction; later ones are
   * STUDENT. With `takeGuestData`, the guest's open owner rows and personal rows
   * move to the new profile; notifications stay where they are.
   */
  createProfile(
    guestId: string,
    profile: NewProfile,
    takeGuestData: boolean,
    at: number,
  ): CreatedProfile {
    return this.#db.raw
      .transaction((): CreatedProfile => {
        const isLead = this.profileCount() === 0;
        const userId = uuid7();
        this.#db.raw
          .prepare(
            `INSERT INTO users (id, department_id, email, display_name, password_hash, status,
               must_change_password, failed_login_count, created_at, created_by, updated_at, version)
             VALUES (?, ?, ?, ?, ?, 'ACTIVE', 0, 0, ?, ?, ?, 1)`,
          )
          .run(
            userId,
            profile.departmentId,
            profile.email,
            profile.displayName,
            profile.passwordHash,
            at,
            guestId,
            at,
          );
        const roles: RoleKey[] = isLead ? ['STUDENT', 'ADMINISTRATOR'] : ['STUDENT'];
        for (const role of roles) this.#grant(userId, role, guestId, at);
        if (isLead) {
          this.#db.raw
            .prepare(
              `DELETE FROM user_roles WHERE user_id = ?
                 AND role_id = (SELECT id FROM roles WHERE key = 'ADMINISTRATOR')`,
            )
            .run(guestId);
        }
        const moved = takeGuestData ? this.#moveGuestData(guestId, userId, at) : 0;
        return { userId, isLead, moved };
      })
      .immediate();
  }

  #grant(userId: string, role: RoleKey, by: string, at: number): void {
    this.#db.raw
      .prepare(
        `INSERT INTO user_roles (user_id, role_id, granted_at, granted_by)
         SELECT ?, id, ?, ? FROM roles WHERE key = ?`,
      )
      .run(userId, at, by, role);
  }

  #moveGuestData(from: string, to: string, at: number): number {
    let moved = 0;
    for (const table of PERSONAL_TABLES) {
      moved += this.#db.raw
        .prepare(`UPDATE ${table} SET user_id = ? WHERE user_id = ?`)
        .run(to, from).changes;
    }
    moved += this.#db.raw
      .prepare(`UPDATE workflow_templates SET created_by = ? WHERE created_by = ?`)
      .run(to, from).changes;
    // Owner rows are closed and reopened rather than rewritten (R95, R105): the
    // history keeps saying the guest owned it until now.
    for (const table of ['team_mentors', 'engagement_mentors'] as const) {
      const parent = table === 'team_mentors' ? 'team_id' : 'engagement_id';
      const open = this.#db.raw
        .prepare(
          `SELECT id, ${parent} AS parent, role FROM ${table} WHERE user_id = ? AND to_at IS NULL`,
        )
        .all(from) as { id: string; parent: string; role: string }[];
      for (const row of open) {
        this.#db.raw.prepare(`UPDATE ${table} SET to_at = ? WHERE id = ?`).run(at, row.id);
        this.#db.raw
          .prepare(
            `INSERT INTO ${table} (id, ${parent}, user_id, role, from_at) VALUES (?, ?, ?, ?, ?)`,
          )
          .run(uuid7(), row.parent, to, row.role, at);
        moved += 1;
      }
    }
    const mentorships = this.#db.raw
      .prepare(
        `SELECT id, student_id AS studentId FROM mentorships WHERE mentor_user_id = ? AND ended_at IS NULL`,
      )
      .all(from) as { id: string; studentId: string }[];
    for (const row of mentorships) {
      this.#db.raw.prepare(`UPDATE mentorships SET ended_at = ? WHERE id = ?`).run(at, row.id);
      this.#db.raw
        .prepare(
          `INSERT INTO mentorships (id, mentor_user_id, student_id, started_at, created_by) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(uuid7(), to, row.studentId, at, to);
      moved += 1;
    }
    return moved;
  }

  /** R134: the lead's switch for walk-in access is a setting; this disables the account too. */
  setGuestStatus(guestId: string, enabled: boolean, at: number): void {
    this.#db.raw
      .prepare(`UPDATE users SET status = ?, updated_at = ? WHERE id = ? AND is_guest = 1`)
      .run(enabled ? 'ACTIVE' : 'DISABLED', at, guestId);
  }
}
