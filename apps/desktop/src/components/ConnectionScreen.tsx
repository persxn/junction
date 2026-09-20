import type { BackendPhase } from '@compintel/contracts';
import { FolderOpen, Loader2, RotateCw, ShieldAlert } from 'lucide-react';

import { connectionCopy } from '../shell/connection-copy.js';

export interface ConnectionScreenProps {
  readonly phase: BackendPhase | undefined;
  /** `BackendStatus.lastError`, shown verbatim when it is not a known case (R26). */
  readonly message: string | null | undefined;
  /** Where the data lives, so the user can find the folder the message is about. */
  readonly dataDir: string | undefined;
  readonly onRetry: () => void;
  readonly onOpenLogs: () => void;
  readonly onCopyDiagnostics: () => void;
}

/**
 * The whole window while the backend is not usable — the screen that replaces
 * WP-05a's diagnostic panel.
 *
 * It is deliberately dumb: every word it shows comes from `connectionCopy()`, so
 * the R26 cases are decided and tested in one place that has no DOM in it.
 * Open logs and Copy diagnostics are always offered, because ruling R25 makes
 * them the only diagnostics that exist before WP-30.
 */
export function ConnectionScreen({
  phase,
  message,
  dataDir,
  onRetry,
  onOpenLogs,
  onCopyDiagnostics,
}: ConnectionScreenProps): React.JSX.Element {
  const copy = connectionCopy(phase, message);
  const failed = copy.tone === 'danger';

  return (
    <div className="flex h-full items-center justify-center bg-surface p-6">
      <div
        role={failed ? 'alert' : 'status'}
        className="flex w-full max-w-lg flex-col gap-4 rounded-lg border border-line bg-surface-raised p-6"
      >
        <div className="flex items-center gap-2">
          {failed ? (
            <ShieldAlert aria-hidden="true" className="size-5 text-danger" />
          ) : (
            <Loader2 aria-hidden="true" className="size-5 animate-spin text-accent" />
          )}
          <h1 className="text-lg">{copy.title}</h1>
        </div>

        <p className="text-fg-muted">{copy.body}</p>
        {copy.hint !== undefined && <p className="text-fg-muted">{copy.hint}</p>}

        {dataDir !== undefined && (
          <p className="text-sm text-fg-subtle">
            Data folder: <code className="break-all">{dataDir}</code>
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onRetry}
            disabled={!copy.canRetry}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 font-medium text-on-accent hover:bg-accent-hover disabled:opacity-50"
          >
            <RotateCw aria-hidden="true" className="size-4" />
            Try again
          </button>
          <button
            type="button"
            onClick={onOpenLogs}
            className="inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 hover:bg-surface-hover"
          >
            <FolderOpen aria-hidden="true" className="size-4" />
            Open logs
          </button>
          <button
            type="button"
            onClick={onCopyDiagnostics}
            className="rounded-md border border-line px-3 py-1.5 hover:bg-surface-hover"
          >
            Copy diagnostics
          </button>
        </div>
      </div>
    </div>
  );
}
