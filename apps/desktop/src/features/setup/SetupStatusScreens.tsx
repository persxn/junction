import { Loader2, PlugZap } from 'lucide-react';

/**
 * The two moments before the wizard can decide anything: while `/setup/status`
 * is in flight, and when it did not answer.
 *
 * Deliberately not `<ConnectionScreen>`: that screen is about the backend's
 * lifecycle (ruling R26) and offers logs and diagnostics for a process that
 * failed to start. Here the backend is up and one call did not land, so the
 * only useful thing to offer is trying it again.
 */

export function SetupChecking(): React.JSX.Element {
  return (
    <div className="flex h-full items-center justify-center bg-surface p-6">
      <p className="flex items-center gap-2.5 text-fg-muted">
        <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        Checking this installation…
      </p>
    </div>
  );
}

export function SetupUnreachable({ onRetry }: { readonly onRetry: () => void }): React.JSX.Element {
  return (
    <div className="flex h-full items-center justify-center bg-surface p-6">
      <div className="flex max-w-md flex-col items-center gap-3 rounded-lg border border-line bg-surface-raised px-6 py-10 text-center">
        <PlugZap aria-hidden="true" className="size-6 text-fg-subtle" />
        <h1 className="text-md">Junction could not read its own setup state</h1>
        <p className="text-fg-muted">
          The background service is running but did not answer. This is usually momentary.
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md bg-accent px-3 py-1.5 font-medium text-on-accent hover:bg-accent-hover"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
