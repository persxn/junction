import { PathActionResult, StatPathsResult } from '@compintel/contracts';
import { invoke, isTauri } from '@tauri-apps/api/core';

import { pickFolder } from './backend.js';

/**
 * A resource's path and the shell (rulings R102–R103, WP-20b). The shell
 * decides what may open; these only ask it and check its answer against the
 * contract. Outside the shell — the web build, `pnpm e2e` — there is no
 * filesystem to ask, and a path can only be copied.
 */

export const inShell = (): boolean => isTauri();

export async function openLocalPath(path: string): Promise<PathActionResult> {
  return PathActionResult.parse(await invoke<unknown>('open_local_path', { path }));
}

export async function revealPath(path: string): Promise<PathActionResult> {
  return PathActionResult.parse(await invoke<unknown>('reveal_path', { path }));
}

export async function statPaths(paths: readonly string[]): Promise<StatPathsResult> {
  return StatPathsResult.parse(await invoke<unknown>('stat_paths', { paths: [...paths] }));
}

export async function machineLabel(): Promise<string> {
  return invoke<string>('machine_label');
}

/** Any file; only its path comes back — nothing reads it (D-12). */
export async function pickResourceFile(): Promise<string | undefined> {
  const picked = await invoke<{ path: string; name: string } | null>('pick_file', {
    title: 'Choose a file to link',
    filter: 'ANY',
  });
  return picked?.path;
}

export async function pickResourceFolder(): Promise<string | undefined> {
  return pickFolder('Choose a folder to link');
}
