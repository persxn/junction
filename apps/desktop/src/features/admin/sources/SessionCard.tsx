import type { SourceSummary } from '@compintel/contracts';
import { ClipboardPaste, Loader2, LogIn, LogOut } from 'lucide-react';
import { useId, useState } from 'react';

import { useSourceSession } from './use-source-session.js';

/**
 * One source's signed-in state (owner ruling R74 / D-34, WP-14; pre-M2a item 3).
 *
 * **One button.** Pressing "Sign in to Devfolio" opens the packaged window on
 * that source's own login page; when the window says it is finished the session
 * is read out of it and stored, with no second button to press. Pasting a cookie
 * from a browser is still here, folded away, for the professor who is already
 * signed in somewhere else.
 *
 * Both ways in are the professor's own account and both are read-only. The value
 * is never held in this component's state, never in `localStorage`, and never in
 * a log line — `useSourceSession` sends it straight to the backend.
 *
 * An expired session is shown as a state of the source with the sentence §7.7
 * gives it, not as an error: the source keeps working from its public pages.
 */

export interface SessionCardProps {
  readonly source: SourceSummary;
}

export function SessionCard({ source }: SessionCardProps): React.JSX.Element {
  const id = useId();
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState('');
  const session = useSourceSession(source);

  const { status, supported } = session;
  const state = status?.state ?? 'NONE';

  return (
    <article
      aria-labelledby={`${id}-name`}
      className="flex flex-col gap-3 rounded-lg border border-line bg-surface-raised px-4 py-3"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={`${id}-name`} className="text-md">
          {source.name}
        </h2>
        <span className="text-fg-muted">{source.complianceStatus.replace(/_/g, ' ')}</span>
      </div>

      {!supported && (
        <p className="text-fg-muted">
          This source is read from its public pages only; there is nothing to sign in to.
        </p>
      )}

      {supported && (
        <>
          <p
            className={
              state === 'EXPIRED' || state === 'UNAVAILABLE'
                ? 'text-warning-strong'
                : 'text-fg-muted'
            }
          >
            {state === 'ACTIVE' && 'Signed in with your own account, read-only.'}
            {state === 'EXPIRED' &&
              `Your ${source.name} session expired — sign in again. Until then ${source.name} is read from its public pages only.`}
            {/* Ruling R76: the session is sealed under a key this machine does
                not have — a backup restored elsewhere, another Windows account. */}
            {state === 'UNAVAILABLE' &&
              `Your ${source.name} session is stored but cannot be opened on this machine — sign in again. Until then ${source.name} is read from its public pages only.`}
            {state === 'NONE' &&
              'Not signed in. Public pages are read; signing in shows whatever your own account can see.'}
          </p>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={session.signingIn}
              onClick={session.signIn}
              className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-1.5 font-medium text-on-accent hover:bg-accent-hover disabled:opacity-50"
            >
              {session.signingIn ? (
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              ) : (
                <LogIn aria-hidden="true" className="size-4" />
              )}
              {state === 'NONE' ? `Sign in to ${source.name}` : `Sign in to ${source.name} again`}
            </button>
            <button
              type="button"
              onClick={() => {
                setPasting((open) => !open);
              }}
              aria-expanded={pasting}
              className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-1.5 font-medium hover:bg-surface-sunken"
            >
              <ClipboardPaste aria-hidden="true" className="size-4" />
              Paste session
            </button>
            {status?.isSet === true && (
              <button
                type="button"
                onClick={session.signOut}
                className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-1.5 font-medium hover:bg-surface-sunken"
              >
                <LogOut aria-hidden="true" className="size-4" />
                Sign out
              </button>
            )}
          </div>

          {pasting && (
            <form
              className="flex flex-col gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                session.savePasted(pasted);
                setPasted('');
              }}
            >
              <label htmlFor={`${id}-cookie`} className="font-medium">
                Cookie header from your browser
              </label>
              <textarea
                id={`${id}-cookie`}
                rows={3}
                value={pasted}
                onChange={(event) => {
                  setPasted(event.target.value);
                }}
                className="rounded-md border border-line bg-surface px-3 py-2 font-mono text-fg"
              />
              <p className="text-sm text-fg-subtle">
                In your browser: developer tools → Application → Cookies, or “copy as cURL” and take
                the Cookie header. It is stored like an API key and sent only to {source.name}.
              </p>
              <button
                type="submit"
                disabled={pasted.trim().length === 0 || session.saving}
                className="w-fit rounded-md bg-accent px-3 py-1.5 font-medium text-on-accent hover:bg-accent-hover disabled:opacity-50"
              >
                Save session
              </button>
            </form>
          )}
        </>
      )}
    </article>
  );
}
