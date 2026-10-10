import { and, eq } from 'drizzle-orm';

import { users } from '../../db/schema/index.js';
import type { DatabaseHandle } from '../../platform/db.js';

/**
 * R135 "This is me": which student row is the signed-in profile's own.
 *
 * One column on `users`, unique where set, so a row is at most one profile's and
 * a profile has at most one row. Linking a new row replaces the old link.
 */
export class ProfileLinks {
  readonly #db: DatabaseHandle;

  constructor(db: DatabaseHandle) {
    this.#db = db;
  }

  /** The profile's own student row, if it has said which one it is. */
  studentOf(userId: string): string | null {
    const row = this.#db.drizzle
      .select({ studentId: users.studentId })
      .from(users)
      .where(eq(users.id, userId))
      .get();
    return row?.studentId ?? null;
  }

  /** Who says this row is them, if anybody. */
  profileOf(studentId: string): string | null {
    const row = this.#db.drizzle
      .select({ id: users.id })
      .from(users)
      .where(eq(users.studentId, studentId))
      .get();
    return row?.id ?? null;
  }

  /** Makes `studentId` this profile's row, taking it from nobody (the caller checked). */
  link(userId: string, studentId: string): void {
    this.#db.drizzle.update(users).set({ studentId }).where(eq(users.id, userId)).run();
  }

  /** Drops the link only if it points at this row. */
  unlink(userId: string, studentId: string): void {
    this.#db.drizzle
      .update(users)
      .set({ studentId: null })
      .where(and(eq(users.id, userId), eq(users.studentId, studentId)))
      .run();
  }
}
