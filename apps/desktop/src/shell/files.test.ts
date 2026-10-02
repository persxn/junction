import { STUDENT_IMPORT_MAX_FILE_BYTES } from '@compintel/contracts';
import { describe, expect, it, vi } from 'vitest';

import { checkBrowserFile, PickedFileError, readBrowserFile } from './files.js';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => false }));

/** The browser stand-in for the shell's picker applies the shell's three checks. */
describe('checkBrowserFile', () => {
  it('takes a .csv or .xlsx up to 700 KB, whatever the case of the name', () => {
    expect(() => {
      checkBrowserFile('List.CSV', 10);
    }).not.toThrow();
    expect(() => {
      checkBrowserFile('list.xlsx', STUDENT_IMPORT_MAX_FILE_BYTES);
    }).not.toThrow();
  });

  it('refuses another kind of file, in words', () => {
    expect(() => {
      checkBrowserFile('list.xls', 10);
    }).toThrow(new PickedFileError('Only .csv and .xlsx files can be imported.'));
  });

  it('refuses a file over the limit before reading it', () => {
    expect(() => {
      checkBrowserFile('list.csv', STUDENT_IMPORT_MAX_FILE_BYTES + 1);
    }).toThrow(/larger than 700 KB/);
  });
});

describe('readBrowserFile', () => {
  it('returns the name and the bytes as base64', async () => {
    const file = new File(['Roll No,Name\n'], 'list.csv', { type: 'text/csv' });
    expect(await readBrowserFile(file)).toEqual({
      name: 'list.csv',
      base64: btoa('Roll No,Name\n'),
    });
  });
});
