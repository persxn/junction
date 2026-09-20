import { closeSync, mkdirSync, openSync, readdirSync, unlinkSync, writeSync } from 'node:fs';
import path from 'node:path';

/** Files are named `<baseName>-YYYY-MM-DD.log`. */
const FILE_SUFFIX = '.log';

export interface DailyRotatingFileOptions {
  /** Directory the log files live in; created if missing. */
  readonly directory: string;
  /** Stem of every file name. */
  readonly baseName?: string;
  /** How many daily files to keep, newest first (ruling R8 says 14). */
  readonly keep?: number;
  /** Injected in tests; defaults to the host machine's local clock (A15). */
  readonly clock?: () => Date;
}

function localDateKey(date: Date): string {
  const year = date.getFullYear().toString().padStart(4, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * A pino destination that appends to one file per day and keeps only the newest
 * `keep` files. Ruling R8 rules out pino's worker-thread transports, so this is
 * an in-house stream: writes are synchronous, which keeps ordering exact and
 * means a crash or `process.exit` can never lose a buffered line. Log volume is
 * low enough (ARCHITECTURE.md 4.14) that the cost does not matter.
 */
export class DailyRotatingFile {
  readonly #directory: string;
  readonly #baseName: string;
  readonly #keep: number;
  readonly #clock: () => Date;
  readonly #pattern: RegExp;

  #fd: number | undefined;
  #dateKey: string | undefined;
  #closed = false;

  constructor(options: DailyRotatingFileOptions) {
    this.#directory = options.directory;
    this.#baseName = options.baseName ?? 'backend';
    this.#keep = options.keep ?? 14;
    this.#clock = options.clock ?? ((): Date => new Date());
    this.#pattern = new RegExp(`^${this.#baseName}-(\\d{4}-\\d{2}-\\d{2})\\.log$`);
    if (this.#keep < 1) {
      throw new RangeError('keep must be at least 1');
    }
  }

  /** Absolute path of the file currently being appended to, once one is open. */
  get currentFile(): string | undefined {
    return this.#dateKey === undefined ? undefined : this.#fileFor(this.#dateKey);
  }

  /** Every retained file, newest first. */
  listFiles(): string[] {
    let entries: string[];
    try {
      entries = readdirSync(this.#directory);
    } catch {
      return [];
    }
    return entries
      .filter((name) => this.#pattern.test(name))
      .sort((a, b) => b.localeCompare(a))
      .map((name) => path.join(this.#directory, name));
  }

  /** pino's destination contract: one already-serialized line per call. */
  write(chunk: string): boolean {
    if (this.#closed) {
      return false;
    }
    const key = localDateKey(this.#clock());
    if (key !== this.#dateKey) {
      this.#rotateTo(key);
    }
    if (this.#fd === undefined) {
      return false;
    }
    writeSync(this.#fd, chunk);
    return true;
  }

  /** Closes the current file. Further writes are ignored. */
  close(): void {
    this.#closed = true;
    this.#closeFd();
  }

  #fileFor(dateKey: string): string {
    return path.join(this.#directory, `${this.#baseName}-${dateKey}${FILE_SUFFIX}`);
  }

  #closeFd(): void {
    if (this.#fd !== undefined) {
      try {
        closeSync(this.#fd);
      } catch {
        // The descriptor is going away either way; there is nowhere left to log this.
      }
      this.#fd = undefined;
    }
  }

  #rotateTo(dateKey: string): void {
    this.#closeFd();
    mkdirSync(this.#directory, { recursive: true });
    this.#fd = openSync(this.#fileFor(dateKey), 'a');
    this.#dateKey = dateKey;
    this.#prune();
  }

  #prune(): void {
    for (const file of this.listFiles().slice(this.#keep)) {
      try {
        unlinkSync(file);
      } catch {
        // A file held open by a log viewer is retried on the next rotation.
      }
    }
  }
}
