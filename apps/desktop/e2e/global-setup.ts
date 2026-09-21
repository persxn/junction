import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';

import { chromium } from '@playwright/test';

import { devRoot, STATE_FILE, type E2eEnvironment } from './environment.js';

/**
 * Before the smoke: prove Edge launches, seed a throwaway database, start the
 * real backend on it, and complete the real setup wizard over HTTP.
 *
 * Nothing here contacts the internet: `seed:demo` switches every source off, so
 * the backend registers no scrape job (the teardown checks `scrape_runs` is
 * empty). The backend is tied to this process by its stdin lifeline, and the
 * teardown also kills it by pid.
 */

const REPO = path.resolve(import.meta.dirname, '..', '..', '..');
const BACKEND = path.join(REPO, 'apps', 'backend');
/** The corpus is laid out around this campus (tools/perf/search/src/run.ts). */
const CAMPUS = { lat: 10.7905, lon: 78.7047 };
const EMAIL = 'e2e-admin@example.edu';
const PASSWORD = 'an-e2e-password-nobody-uses';

async function assertEdge(): Promise<void> {
  try {
    const browser = await chromium.launch({ channel: 'msedge' });
    await browser.close();
  } catch (cause) {
    throw new Error(
      `Microsoft Edge could not be launched for the E2E smoke (channel "msedge"). Install Edge or repair it; ` +
        `no browser is downloaded by design. Cause: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
}

function seed(dataDir: string): void {
  // One command string: `pnpm` is a .cmd shim on Windows, so it needs a shell,
  // and the only argument is a path this function built itself.
  const result = spawnSync(`pnpm seed:demo --data-dir "${dataDir}" --events 300`, {
    cwd: REPO,
    shell: true,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`pnpm seed:demo failed:\n${result.stdout}\n${result.stderr}`);
  }
}

async function startBackend(
  dataDir: string,
  clientSecret: string,
): Promise<{ port: number; pid: number }> {
  const tsx = path.join(BACKEND, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const child = spawn(
    process.execPath,
    [tsx, 'src/main.ts', '--data-dir', dataDir, '--port', '0', '--stdin-lifeline'],
    {
      cwd: BACKEND,
      env: { ...process.env, COMPINTEL_CLIENT_SECRET: clientSecret },
      stdio: ['pipe', 'pipe', 'inherit'],
    },
  );
  // Keep the lifeline open for the whole run: the backend exits when it closes.
  (globalThis as { e2eBackend?: typeof child }).e2eBackend = child;
  const lines = createInterface({ input: child.stdout });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('The backend did not print its READY line within 60 s.'));
    }, 60_000);
    lines.on('line', (line) => {
      const ready = JSON.parse(line) as {
        ready: boolean;
        port?: number;
        pid?: number;
        error?: unknown;
      };
      clearTimeout(timer);
      if (ready.ready && ready.port !== undefined && ready.pid !== undefined) {
        resolve({ port: ready.port, pid: ready.pid });
      } else {
        reject(new Error(`The backend failed to start: ${JSON.stringify(ready.error)}`));
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`The backend exited before READY (code ${String(code)}).`));
    });
  });
}

async function completeSetup(
  baseUrl: string,
  clientSecret: string,
  dataDir: string,
): Promise<void> {
  const backupDir = `${dataDir}-backups`;
  mkdirSync(backupDir, { recursive: true });
  const response = await fetch(`${baseUrl}/api/v1/setup/complete`, {
    method: 'POST',
    headers: { 'X-CompIntel-Client': clientSecret, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      organization: { name: 'E2E Institute of Technology' },
      department: { name: 'Computer Science and Engineering', code: 'CSE' },
      campus: { name: 'Main Campus', ...CAMPUS },
      admin: { email: EMAIL, displayName: 'E2E Admin', password: PASSWORD },
      scraperContactEmail: 'e2e@example.edu',
      backupDir,
      backupPassphrase: 'an-e2e-backup-passphrase',
    }),
  });
  if (!response.ok) {
    throw new Error(`Setup failed: ${String(response.status)} ${await response.text()}`);
  }
}

/** Earlier runs' throwaway directories (only ever under the dev-data root). */
function removeOldRuns(): void {
  const root = path.join(devRoot(), 'e2e');
  mkdirSync(root, { recursive: true });
  for (const entry of readdirSync(root)) {
    if (entry.startsWith('run-')) {
      rmSync(path.join(root, entry), {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 200,
      });
    }
  }
}

export default async function globalSetup(): Promise<void> {
  await assertEdge();
  removeOldRuns();
  const dataDir = path.join(
    devRoot(),
    'e2e',
    `run-${new Date().toISOString().replace(/[:.]/g, '-')}`,
  );
  seed(dataDir);
  const clientSecret = randomBytes(32).toString('hex');
  const { port, pid } = await startBackend(dataDir, clientSecret);
  const baseUrl = `http://127.0.0.1:${String(port)}`;
  await completeSetup(baseUrl, clientSecret, dataDir);
  const environment: E2eEnvironment = {
    dataDir,
    baseUrl,
    port,
    clientSecret,
    pid,
    email: EMAIL,
    password: PASSWORD,
  };
  mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(environment, null, 2));
}
