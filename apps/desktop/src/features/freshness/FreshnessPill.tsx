import { isScrapedSource } from '@compintel/contracts';
import { Info, RefreshCw } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { ago } from '../../lib/ago.js';
import { useNow } from '../../lib/use-now.js';
import { SOURCE_HEALTH } from './source-health.js';
import { useSourceStatus } from './use-source-status.js';

export interface FreshnessPillProps {
  /** Test seam: the popover can start open so axe sees it. */
  readonly defaultOpen?: boolean;
  readonly refetchIntervalMs?: number;
}

/**
 * The top bar's freshness pill and its per-source status popover (§16.1).
 *
 * "Updated 4 min ago" counts from the newest successful run of any source, and
 * the popover says, per source, what state it is in (icon **and** label), when
 * it last succeeded, when it will try again and — on a failure — §7.7's
 * sentence, written by the backend so the log, the API and this screen cannot
 * word the same failure three ways.
 *
 * Being offline is an info line, not an error (D-23): the whole point of this
 * app working offline is that the professor is told what they are looking at,
 * not stopped from looking at it.
 *
 * **R29:** this is the in-app surface only. The tray stays static until WP-30.
 */
export function FreshnessPill({
  defaultOpen = false,
  refetchIntervalMs,
}: FreshnessPillProps): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const now = useNow();
  const status = useSourceStatus(refetchIntervalMs);

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event: MouseEvent): void => {
      if (root.current !== null && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('mousedown', onPointer);
    };
  }, [open]);

  const updatedAt = status.data?.updatedAt ?? null;
  const label =
    status.data === undefined
      ? 'Checking for updates'
      : updatedAt === null
        ? 'No updates yet'
        : `Updated ${ago(Date.parse(updatedAt), now)}`;

  return (
    <div
      ref={root}
      className="relative"
      onKeyDown={(event) => {
        // On the wrapper, not the panel: Esc has to work while focus is still
        // on the trigger, which is where it is the moment the popover opens.
        if (event.key !== 'Escape' || !open) return;
        event.stopPropagation();
        event.nativeEvent.stopImmediatePropagation();
        setOpen(false);
        button.current?.focus();
      }}
    >
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-haspopup="dialog"
        data-testid="freshness-pill"
        onClick={() => {
          setOpen((value) => !value);
        }}
        className="flex items-center gap-1.5 rounded-full bg-surface-sunken px-2.5 py-1 text-sm text-fg-muted hover:bg-surface-hover"
      >
        <RefreshCw aria-hidden="true" className="size-3.5" />
        {label}
      </button>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label="Source status"
          data-testid="freshness-popover"
          className="absolute right-0 z-30 mt-1 w-96 rounded-lg border border-line bg-surface-raised p-3 shadow-[var(--ci-shadow-popover)]"
        >
          <h2 className="mb-2 text-sm font-medium">Source status</h2>

          {status.data?.offline === true && (
            <p className="mb-2 flex items-start gap-2 rounded-md border border-line bg-surface-sunken p-2 text-sm text-fg-muted">
              <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              You&apos;re offline. Showing events from the last update
              {updatedAt === null ? '' : ` (${ago(Date.parse(updatedAt), now)})`}.
            </p>
          )}

          {status.data === undefined ? (
            <p className="text-sm text-fg-muted">Reading the source list…</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {status.data.sources
                .filter((source) => isScrapedSource(source.adapter))
                .map((source) => {
                  const health = SOURCE_HEALTH[source.health];
                  const HealthIcon = health.icon;
                  return (
                    <li key={source.key} className="flex flex-col gap-0.5 text-sm">
                      <span className="flex items-center gap-2">
                        <HealthIcon
                          aria-hidden="true"
                          className={`size-3.5 shrink-0 ${health.tone}`}
                        />
                        <span className="font-medium">{source.name}</span>
                        <span className={health.tone}>{health.label}</span>
                      </span>
                      <span className="pl-5 text-xs text-fg-muted">
                        Last success:{' '}
                        {source.lastSuccessAt === null
                          ? 'never'
                          : ago(Date.parse(source.lastSuccessAt), now)}
                        {/* A source nobody is asking has no next run to promise. */}
                        {source.health !== 'PAUSED_BY_POLICY' && (
                          <>
                            {' · Next run: '}
                            {source.nextAttemptAt === null
                              ? 'not scheduled'
                              : ago(Date.parse(source.nextAttemptAt), now)}
                          </>
                        )}
                      </span>
                      {source.health !== 'OK' && (
                        <span className="pl-5 text-xs text-fg-muted">{source.message}</span>
                      )}
                    </li>
                  );
                })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
