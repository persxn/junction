import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

import { ReadyLine } from '@compintel/contracts';

export interface SpawnBackendOptions {
  /** Executable to run, usually `process.execPath`. */
  readonly command: string;
  readonly args: readonly string[];
  /** Extra environment on top of a minimal inherited set. */
  readonly env?: NodeJS.ProcessEnv;
  /** How long to wait for the READY line. */
  readonly readyTimeoutMs?: number;
}

export interface BackendProcess {
  readonly child: ChildProcessWithoutNullStreams;
  /** The single JSON line the backend wrote to stdout (ruling R7). */
  readonly ready: ReadyLine;
  /** Anything that followed the READY line on stdout - must stay empty. */
  trailingStdout(): string;
  stderr(): string;
  /** Resolves with the exit code, or rejects if the process outlives the timeout. */
  waitForExit(timeoutMs?: number): Promise<number | null>;
}

const DEFAULT_READY_TIMEOUT_MS = 20_000;

/**
 * Starts a backend process and waits for its first stdout line. Used by both the
 * process tests and `smoke:bundle`, so the two agree on what the handshake is.
 */
export function spawnBackend(options: SpawnBackendOptions): Promise<BackendProcess> {
  const child = spawn(options.command, [...options.args], {
    env: { ...process.env, ...options.env },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let stdout = '';
  let stderr = '';
  let firstLine: string | undefined;

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });

  const exited = new Promise<number | null>((resolve) => {
    child.on('exit', (code) => {
      resolve(code);
    });
  });

  const handle = (line: string): BackendProcess => ({
    child,
    ready: ReadyLine.parse(JSON.parse(line)),
    trailingStdout: () => stdout.slice(line.length + 1),
    stderr: () => stderr,
    waitForExit: async (timeoutMs = 10_000) => {
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          child.kill();
          reject(new Error(`The backend was still running after ${timeoutMs.toString()} ms.`));
        }, timeoutMs);
      });
      try {
        return await Promise.race([exited, timeout]);
      } finally {
        clearTimeout(timer);
      }
    },
  });

  return new Promise<BackendProcess>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(
        new Error(
          `No READY line within ${(options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS).toString()} ms.\n` +
            `stdout: ${stdout}\nstderr: ${stderr}`,
        ),
      );
    }, options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS);

    const settle = (): void => {
      if (firstLine !== undefined) {
        return;
      }
      const newline = stdout.indexOf('\n');
      if (newline === -1) {
        return;
      }
      firstLine = stdout.slice(0, newline);
      clearTimeout(timer);
      try {
        resolve(handle(firstLine));
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    };

    child.stdout.on('data', settle);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', () => {
      settle();
      if (firstLine === undefined) {
        clearTimeout(timer);
        reject(new Error(`The backend exited without a READY line.\nstderr: ${stderr}`));
      }
    });
  });
}

/** Base URL of a started backend. Throws if the process reported a failed start. */
export function baseUrlOf(backend: BackendProcess): string {
  if (!backend.ready.ready) {
    throw new Error(`The backend failed to start: ${backend.ready.error.message}`);
  }
  return `http://127.0.0.1:${backend.ready.port.toString()}`;
}
