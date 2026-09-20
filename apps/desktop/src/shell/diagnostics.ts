import type { ApiTransport, BackendStatus, ShellSettings } from '@compintel/contracts';

/**
 * "Copy diagnostics" (ruling R25).
 *
 * The shell keeps no log of its own until WP-30, so until then this text is the
 * only record of what the shell thought was happening. R25 therefore requires
 * `backend_status()` and the shell settings **verbatim** — no prettifying, no
 * dropped fields — plus enough context to tell one report from another.
 */
export interface Diagnostics {
  readonly status: BackendStatus | undefined;
  readonly settings: ShellSettings | undefined;
  readonly transport: ApiTransport;
  /** The last thing that went wrong, as the UI showed it. */
  readonly error?: string | undefined;
}

export function formatDiagnostics(input: Diagnostics, now: Date = new Date()): string {
  return JSON.stringify(
    {
      report: 'compintel-diagnostics',
      capturedAt: now.toISOString(),
      userAgent: globalThis.navigator?.userAgent ?? 'unknown',
      apiTransport: input.transport,
      lastError: input.error ?? null,
      // Verbatim, per R25.
      backendStatus: input.status ?? null,
      shellSettings: input.settings ?? null,
    },
    null,
    2,
  );
}

/**
 * Copies the report to the clipboard. Returns whether it worked, so the caller
 * can tell the user rather than silently pretending it did.
 */
export async function copyDiagnostics(text: string): Promise<boolean> {
  try {
    await globalThis.navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
