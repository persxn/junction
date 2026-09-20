import { Component, type ErrorInfo, type ReactNode } from 'react';

import { absoluteTime, relativeTime } from '../lib/time.js';

export interface ErrorBoundaryProps {
  readonly children: ReactNode;
  /** What broke, in the user's words: "the dashboard", "the app". */
  readonly label: string;
  /**
   * When this part of the UI last had data it could trust. §16.3 requires every
   * error to say "when data was last good", because that is what tells the user
   * whether what they were looking at is still worth acting on.
   */
  readonly lastGoodAt?: Date | undefined;
  /** Runs after the boundary resets — re-fetch, re-mount, whatever applies. */
  readonly onRetry?: (() => void) | undefined;
}

interface ErrorBoundaryState {
  readonly error: Error | undefined;
}

/**
 * The last line of defence: a render that throws must not leave a blank window.
 *
 * It answers the three questions §16.3 asks of an error state — what happened,
 * when the data was last good, and what to do — and nothing more. It deliberately
 * does not report anywhere: the shell has no log of its own until WP-30 (ruling
 * R25), so the message on screen *is* the record.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: undefined };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // No client-log endpoint is wired up yet (A19 defines one for WP-30), so the
    // developer console is the only place this can go.
    console.error(`[${this.props.label}] render failed`, error, info.componentStack);
  }

  private readonly retry = (): void => {
    this.setState({ error: undefined });
    this.props.onRetry?.();
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (error === undefined) {
      return this.props.children;
    }
    const { label, lastGoodAt } = this.props;
    return (
      <div
        role="alert"
        className="m-6 flex max-w-xl flex-col gap-3 rounded-lg border border-danger bg-danger-surface p-5"
      >
        <h2 className="text-md">Something went wrong in {label}</h2>
        <p className="text-fg-muted">{error.message}</p>
        <p className="text-sm text-fg-muted">
          {lastGoodAt === undefined ? (
            'Nothing had loaded yet, so no data was lost.'
          ) : (
            <>
              Last good data:{' '}
              <time dateTime={lastGoodAt.toISOString()}>{relativeTime(lastGoodAt)}</time> (
              {absoluteTime(lastGoodAt)}).
            </>
          )}
        </p>
        <div>
          <button
            type="button"
            onClick={this.retry}
            className="rounded-md bg-accent px-3 py-1.5 font-medium text-on-accent hover:bg-accent-hover"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }
}
