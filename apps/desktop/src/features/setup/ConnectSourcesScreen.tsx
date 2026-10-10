import type { SourceSummary } from '@compintel/contracts';
import { Loader2, ShieldCheck } from 'lucide-react';

import { SessionCard } from '../admin/sources/SessionCard.js';

/**
 * "Connect your sources", the one-time step after the wizard (R74's product
 * flow, R75's limits).
 *
 * R74 has each professor sign in to the approved sources with their **own**
 * account, so this screen's real job is to be honest about what that means
 * before anybody presses a button: the session is used read-only, on that site's
 * own pages, for the professor's own registrations and for a detail page the
 * public version does not carry — and the scheduled listing walks stay anonymous
 * (R75), so nothing a student does is attached to this account.
 *
 * Every card is `SessionCard`, exactly as Admin → Sources renders it. There is
 * no second sign-in flow here and there must never be one: two implementations
 * of "store the professor's cookie" is one too many.
 *
 * "Skip for now" is as final as finishing (R74 offers, it does not require) —
 * Admin → Sources reopens the step whenever they like, which the last line says.
 */

export interface ConnectSourcesScreenProps {
  readonly sources: readonly SourceSummary[];
  /** Both buttons call this; the difference is only what the professor did first. */
  readonly onDone: () => void;
  readonly isSaving: boolean;
  /** Set when the step was reopened from Admin → Sources rather than offered. */
  readonly reopened?: boolean;
}

export function ConnectSourcesScreen({
  sources,
  onDone,
  isSaving,
  reopened = false,
}: ConnectSourcesScreenProps): React.JSX.Element {
  return (
    <div className="flex h-full items-center justify-center overflow-auto bg-surface-sunken p-6">
      <section
        aria-labelledby="connect-sources-title"
        className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-[var(--ci-shadow-popover)]"
      >
        <div className="min-h-0 flex-1 overflow-auto p-8">
          <h1 id="connect-sources-title" className="font-display text-xl">
            Connect your sources
          </h1>
          <p className="mt-1.5 text-fg-muted">
            Some sites show you more when you are signed in. You can sign in with your own account
            now, or do it later — Junction reads their public pages either way.
          </p>

          <p className="mt-4 flex items-start gap-2 rounded-md border border-line bg-surface-raised p-3 text-sm text-fg-muted">
            <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
            <span>
              Your session is used <strong className="font-medium text-fg">read-only</strong>, on
              that site’s own pages: your registrations and teams, and details a public page leaves
              out. The regular checks for new events stay anonymous, and nothing is ever submitted,
              entered or changed on your behalf.
            </span>
          </p>

          <div className="mt-6 flex flex-col gap-4">
            {sources.length === 0 ? (
              <p className="text-fg-muted">
                None of the sources Junction reads has anything to sign in to, so there is nothing
                to do here.
              </p>
            ) : (
              sources.map((source) => <SessionCard key={source.key} source={source} />)
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line bg-surface-raised px-8 py-4">
          <p className="text-sm text-fg-subtle">
            You can change this any time in Admin → Sources &amp; scraper.
          </p>
          <div className="flex items-center gap-2">
            {!reopened && (
              <button
                type="button"
                onClick={onDone}
                disabled={isSaving}
                className="rounded-md border border-line px-3 py-1.5 font-medium hover:bg-surface-sunken disabled:opacity-50"
              >
                Skip for now
              </button>
            )}
            <button
              type="button"
              onClick={onDone}
              disabled={isSaving}
              className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-1.5 font-medium text-on-accent hover:bg-accent-hover disabled:opacity-50"
            >
              {isSaving && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
              {reopened ? 'Close' : 'Continue'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
