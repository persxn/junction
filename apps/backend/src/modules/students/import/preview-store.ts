import { randomBytes } from 'node:crypto';

import { STUDENT_IMPORT_PREVIEW_TTL_MS, type StudentImportColumn } from '@compintel/contracts';

import type { RowPlan } from '../../../domain/students/import-rows.js';
import { nowMs, type Clock } from '../../../platform/time.js';
import { previewExpired, previewNotFound } from '../errors.js';

/**
 * Previews waiting for their commit (ruling R93).
 *
 * In memory on purpose: the file never touches the disk, and a restart simply
 * means "choose the file again" (410). Each preview is bound to the user who
 * made it — another user's id is a 404, as if it did not exist — and is kept for
 * 30 minutes. A ceiling stops a burst of previews holding the process's memory.
 */

export interface StoredPreview {
  readonly userId: string;
  readonly createdAt: number;
  readonly fileName: string;
  readonly rows: readonly (readonly string[])[];
  readonly firstRowNumber: number;
  readonly columns: readonly StudentImportColumn[];
  readonly mappingOk: boolean;
  /** What the preview showed, to compare with the commit's fresh look (stale rows). */
  readonly plans: readonly RowPlan[];
}

export const MAX_STORED_PREVIEWS = 20;

export class PreviewStore {
  readonly #entries = new Map<string, StoredPreview>();
  readonly #clock: Clock;
  readonly #ttlMs: number;

  constructor(clock: Clock, ttlMs = STUDENT_IMPORT_PREVIEW_TTL_MS) {
    this.#clock = clock;
    this.#ttlMs = ttlMs;
  }

  /** Stores a preview and returns its random id. */
  put(preview: StoredPreview): string {
    this.#prune();
    while (this.#entries.size >= MAX_STORED_PREVIEWS) {
      const oldest = this.#entries.keys().next().value;
      if (oldest === undefined) break;
      this.#entries.delete(oldest);
    }
    const id = randomBytes(24).toString('base64url');
    this.#entries.set(id, preview);
    return id;
  }

  /** The caller's preview; 404 for someone else's, 410 when it is gone. */
  get(userId: string, id: string): StoredPreview {
    this.#prune();
    const entry = this.#entries.get(id);
    if (entry === undefined) throw previewExpired();
    if (entry.userId !== userId) throw previewNotFound();
    return entry;
  }

  /** A committed preview is spent. */
  delete(id: string): void {
    this.#entries.delete(id);
  }

  expiresAt(preview: StoredPreview): number {
    return preview.createdAt + this.#ttlMs;
  }

  #prune(): void {
    const now = nowMs(this.#clock);
    for (const [id, entry] of this.#entries) {
      if (now - entry.createdAt >= this.#ttlMs) this.#entries.delete(id);
    }
  }
}
