import type { SourceSummary } from '@compintel/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LogIn, LogOut, ClipboardPaste, Loader2 } from 'lucide-react';
import { useId, useState } from 'react';

import {
  clearSourceSession,
  getSourceSession,
  setSourceSession,
} from '../../../api/admin-sources.js';
import { isApiProblem, type ApiProblem } from '../../../api/problem.js';
import { useToast } from '../../../components/toast/ToastProvider.js';
import { useBackendConnection } from '../../../shell/connection-context.js';
import { captureSourceSession, openSourceSignIn } from '../../../shell/backend.js';

/**
 * One source's signed-in state (owner ruling R74 / D-34, WP-14 step 12).
 *
 * Two ways in, both the professor's own account and both read-only: a window
 * the app opens on the source's own login page, or a cookie pasted from the
 * browser they are already signed in to. The value is sent straight to the
 * backend and is never held in this component's state, never in `localStorage`,
 * and never in a log line.
 *
 * An expired session is shown as a state of the source with the sentence §7.7
 * gives it, not as an error: the source keeps working from its public pages.
 */

export interface SessionCardProps {
  readonly source: SourceSummary;
}

export function SessionCard({ source }: SessionCardProps): React.JSX.Element {
  const connection = useBackendConnection();
  const queryClient = useQueryClient();
  const toast = useToast();
  const id = useId();
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState('');

  const session = useQuery({
    queryKey: ['admin', 'sources', source.key, 'session'],
    queryFn: async () => getSourceSession(connection, source.key),
  });

  const invalidate = async (): Promise<void> => {
    await queryClient.invalidateQueries({
      queryKey: ['admin', 'sources', source.key, 'session'],
    });
  };

  const complain = (cause: unknown): void => {
    const problem = cause as ApiProblem;
    toast.show({
      tone: 'danger',
      title: isApiProblem(cause) ? problem.title : 'That did not work',
      description: isApiProblem(cause) ? (problem.detail ?? '') : String(cause),
    });
  };

  const store = useMutation({
    mutationFn: async (input: { cookie: string; via: 'PASTE' | 'LOGIN_WINDOW' }) =>
      setSourceSession(connection, source.key, input.cookie, input.via),
    onSuccess: async () => {
      setPasting(false);
      setPasted('');
      toast.show({
        tone: 'success',
        title: `Signed in to ${source.name}`,
        description: 'Your session is used read-only, on that site’s pages only.',
      });
      await invalidate();
    },
    onError: complain,
  });

  const signOut = useMutation({
    mutationFn: async () => clearSourceSession(connection, source.key),
    onSuccess: invalidate,
    onError: complain,
  });

  const signIn = useMutation({
    mutationFn: async () => {
      const status = session.data;
      if (status?.loginUrl === undefined) {
        throw new Error('That source has no sign-in page.');
      }
      await openSourceSignIn({
        sourceKey: source.key,
        loginUrl: status.loginUrl,
        hosts: status.hosts,
      });
    },
    onError: complain,
  });

  const capture = useMutation({
    mutationFn: async () => {
      const status = session.data;
      if (status?.loginUrl === undefined) {
        throw new Error('That source has no sign-in page.');
      }
      const result = await captureSourceSession({
        sourceKey: source.key,
        loginUrl: status.loginUrl,
        hosts: status.hosts,
      });
      if (result.cookie === '') {
        throw new Error('The sign-in window is not signed in yet.');
      }
      return setSourceSession(connection, source.key, result.cookie, 'LOGIN_WINDOW');
    },
    onSuccess: async () => {
      toast.show({
        tone: 'success',
        title: `Signed in to ${source.name}`,
        description: 'Your session is used read-only, on that site’s pages only.',
      });
      await invalidate();
    },
    onError: complain,
  });

  const status = session.data;
  const supported = status?.supported === true;
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
          <p className={state === 'EXPIRED' ? 'text-warning-strong' : 'text-fg-muted'}>
            {state === 'ACTIVE' && 'Signed in with your own account, read-only.'}
            {state === 'EXPIRED' &&
              `Your ${source.name} session expired — sign in again. Until then ${source.name} is read from its public pages only.`}
            {state === 'NONE' &&
              'Not signed in. Public pages are read; signing in shows whatever your own account can see.'}
          </p>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                signIn.mutate();
              }}
              className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-1.5 font-medium text-on-accent hover:bg-accent-hover"
            >
              <LogIn aria-hidden="true" className="size-4" />
              Open sign-in window
            </button>
            <button
              type="button"
              disabled={capture.isPending}
              onClick={() => {
                capture.mutate();
              }}
              className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-1.5 font-medium hover:bg-surface-sunken disabled:opacity-50"
            >
              {capture.isPending && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
              Use this session
            </button>
            <button
              type="button"
              onClick={() => {
                setPasting((open) => !open);
              }}
              className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-1.5 font-medium hover:bg-surface-sunken"
            >
              <ClipboardPaste aria-hidden="true" className="size-4" />
              Paste session
            </button>
            {status?.isSet === true && (
              <button
                type="button"
                onClick={() => {
                  signOut.mutate();
                }}
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
                store.mutate({ cookie: pasted, via: 'PASTE' });
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
                disabled={pasted.trim().length === 0 || store.isPending}
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
