import { STUDENT_IMPORT_MAX_FILE_BYTES } from '@compintel/contracts';
import { invoke, isTauri } from '@tauri-apps/api/core';

/**
 * Choosing a student list to import (WP-17 step 5).
 *
 * In the packaged app the shell opens a native dialog, remembers the one file
 * the professor chose, and reads that file and no other (`picked.rs`). In a
 * browser — `vite dev`, Playwright — there is no shell, so a hidden
 * `<input type="file">` stands in, with the same three checks: a `.csv` or
 * `.xlsx` name, at most 700 KB, and nothing read until it is chosen.
 */

export interface PickedFile {
  readonly name: string;
  /** The file's bytes, base64 — what the preview request carries (R93). */
  readonly base64: string;
}

const ACCEPTED = ['.csv', '.xlsx'];
const LIMIT_TEXT = `${String(STUDENT_IMPORT_MAX_FILE_BYTES / 1024)} KB`;

/** Thrown with a message the import wizard shows as it is. */
export class PickedFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PickedFileError';
  }
}

/** The browser stand-in's checks, the same as the shell's. */
export function checkBrowserFile(name: string, size: number): void {
  const lower = name.toLowerCase();
  if (!ACCEPTED.some((extension) => lower.endsWith(extension))) {
    throw new PickedFileError('Only .csv and .xlsx files can be imported.');
  }
  if (size > STUDENT_IMPORT_MAX_FILE_BYTES) {
    throw new PickedFileError(
      `That file is larger than ${LIMIT_TEXT}, so it was not read. Split it into smaller files.`,
    );
  }
}

async function base64Of(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

/** A file from a browser `<input type="file">`, checked and read. */
export async function readBrowserFile(file: File): Promise<PickedFile> {
  checkBrowserFile(file.name, file.size);
  return { name: file.name, base64: await base64Of(file) };
}

function pickInBrowser(): Promise<File | undefined> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = ACCEPTED.join(',');
    input.style.display = 'none';
    input.addEventListener('change', () => {
      resolve(input.files?.[0]);
      input.remove();
    });
    input.addEventListener('cancel', () => {
      resolve(undefined);
      input.remove();
    });
    document.body.append(input);
    input.click();
  });
}

/** Asks the professor for a student list; `undefined` when they cancel. */
export async function pickImportFile(): Promise<PickedFile | undefined> {
  if (isTauri()) {
    const picked = await invoke<{ path: string; name: string } | null>('pick_file', {
      title: 'Choose a student list (CSV or Excel)',
    });
    if (picked === null) return undefined;
    try {
      const base64 = await invoke<string>('read_picked_file', { path: picked.path });
      return { name: picked.name, base64 };
    } catch (cause) {
      throw new PickedFileError(String(cause));
    }
  }
  const file = await pickInBrowser();
  return file === undefined ? undefined : readBrowserFile(file);
}
