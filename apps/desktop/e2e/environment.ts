import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/**
 * What global setup hands the spec and the teardown: where the throwaway
 * backend lives and how to reach it. Written under the dev-data root, never in
 * the repository (CLAUDE.md).
 */

export interface E2eEnvironment {
  readonly dataDir: string;
  readonly baseUrl: string;
  readonly port: number;
  readonly clientSecret: string;
  readonly pid: number;
  readonly email: string;
  readonly password: string;
}

export function devRoot(): string {
  const base = process.env.LOCALAPPDATA ?? path.join(homedir(), 'AppData', 'Local');
  return path.join(base, 'CompIntel-dev');
}

export const STATE_FILE = path.join(devRoot(), 'e2e', 'state.json');

export function readEnvironment(): E2eEnvironment {
  return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as E2eEnvironment;
}
