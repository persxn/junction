import { createRequire } from 'node:module';
import path from 'node:path';

import { readEnvironment } from './environment.js';

/**
 * After the smoke: stop the backend, then prove from its database that it made
 * no scrape run — i.e. no request to any event website (CLAUDE.md, §7.2).
 */
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export default async function globalTeardown(): Promise<void> {
  const environment = readEnvironment();
  const child = (
    globalThis as { e2eBackend?: { kill: () => void; stdin: { end: () => void } | null } }
  ).e2eBackend;
  // Graceful first: closing the stdin lifeline makes the backend shut down and
  // checkpoint its WAL (§3.2). A hard kill is only the fallback.
  child?.stdin?.end();
  const graceful = Date.now() + 15_000;
  while (alive(environment.pid) && Date.now() < graceful) {
    await sleep(100);
  }
  if (alive(environment.pid)) {
    try {
      process.kill(environment.pid);
    } catch {
      // Gone between the check and the kill.
    }
  }
  const requireFromBackend = createRequire(
    path.resolve(import.meta.dirname, '..', '..', 'backend', 'package.json'),
  );
  const Database = requireFromBackend('better-sqlite3') as new (
    file: string,
    options: { fileMustExist: boolean },
  ) => { prepare: (sql: string) => { get: () => { n: number } }; close: () => void };
  // Windows releases a dead process's file handles a moment late; retry briefly.
  let db: InstanceType<typeof Database> | undefined;
  for (let attempt = 0; db === undefined; attempt += 1) {
    try {
      const candidate = new Database(path.join(environment.dataDir, 'data', 'app.db'), {
        fileMustExist: true,
      });
      candidate.prepare('SELECT 1 AS n').get();
      db = candidate;
    } catch (cause) {
      if (attempt >= 40) throw cause;
      await sleep(250);
    }
  }
  try {
    const runs = db.prepare('SELECT count(*) AS n FROM scrape_runs').get().n;
    console.log(`e2e teardown: scrape_runs = ${String(runs)} (no event website was contacted)`);
    if (runs !== 0) {
      throw new Error(
        `The E2E backend recorded ${String(runs)} scrape run(s); it must record none.`,
      );
    }
  } finally {
    db.close();
  }
}
