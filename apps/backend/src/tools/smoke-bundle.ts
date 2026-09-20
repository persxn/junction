import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { HealthResponse } from '@compintel/contracts';

import { baseUrlOf, spawnBackend } from '../testing/backend-process.js';

const BUNDLE = fileURLToPath(new URL('../../dist-bundle/main.mjs', import.meta.url));

function check(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`smoke:bundle - ${message}`);
  }
}

const dataDir = mkdtempSync(path.join(tmpdir(), 'compintel-smoke-'));
const clientSecret = randomBytes(32).toString('hex');
const steps: string[] = [];

try {
  const backend = await spawnBackend({
    command: process.execPath,
    args: [BUNDLE, '--data-dir', dataDir, '--stdin-lifeline'],
    env: { COMPINTEL_CLIENT_SECRET: clientSecret, PORT: '0' },
  });

  check(backend.ready.ready, 'the bundle did not report ready:true');
  const baseUrl = baseUrlOf(backend);
  steps.push(`READY parsed: ${JSON.stringify(backend.ready)}`);

  const response = await fetch(`${baseUrl}/api/v1/health`, {
    headers: { 'X-CompIntel-Client': clientSecret },
  });
  check(response.status === 200, `/health answered ${response.status.toString()}, expected 200`);
  const health = HealthResponse.parse(await response.json());
  steps.push(`/health 200: appVersion=${health.appVersion} apiVersion=${health.apiVersion}`);

  const unauthorized = await fetch(`${baseUrl}/api/v1/health`);
  check(
    unauthorized.status === 401,
    `/health without the secret answered ${unauthorized.status.toString()}, expected 401`,
  );
  steps.push('/health without the secret: 401');

  backend.child.stdin.end();
  const code = await backend.waitForExit(10_000);
  check(code === 0, `the bundle exited with code ${String(code)}, expected 0`);
  steps.push('stdin EOF: exit 0');

  check(
    backend.trailingStdout().trim().length === 0,
    `the bundle wrote more than the READY line to stdout: ${backend.trailingStdout()}`,
  );
  steps.push('stdout carried only the READY line');

  for (const step of steps) {
    process.stdout.write(`  ok  ${step}\n`);
  }
  process.stdout.write('smoke:bundle PASSED\n');
} finally {
  rmSync(dataDir, { recursive: true, force: true });
}
