import type { SourceSessionStatus, SourceSummary } from '@compintel/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import {
  clearSourceSession,
  getSourceSession,
  setSourceSession,
} from '../../../api/admin-sources.js';
import { isApiProblem, type ApiProblem } from '../../../api/problem.js';
import { useToast } from '../../../components/toast/ToastProvider.js';
import { useBackendConnection } from '../../../shell/connection-context.js';
import {
  captureSourceSession,
  onSignInFinished,
  openSourceSignIn,
} from '../../../shell/backend.js';

/**
 * One source's signed-in state, as a state machine the card renders (R74/D-34).
 *
 * The flow is the whole point of this file. WP-14 gave the professor two
 * buttons — open the window, then come back and press "Use this session" —
 * because the window could not tell the UI it was done. It can now
 * (`signin://finished`), so there is one button, and everything that happens
 * after it is pressed happens here: the window opens, the professor signs in,
 * the window says so, the cookies are read out of it and sent to the backend,
 * and the card shows the state the backend answers with.
 *
 * The cookie never becomes React state. It goes from the shell to
 * `PUT /admin/sources/:key/session` and nowhere else — not into a store, not
 * into a log line, not into a toast.
 */

export function sessionQueryKey(key: string): readonly string[] {
  return ['admin', 'sources', key, 'session'];
}

export interface SourceSessionView {
  readonly status: SourceSessionStatus | undefined;
  readonly supported: boolean;
  /** A sign-in is open or its capture is in flight; the button says so. */
  readonly signingIn: boolean;
  readonly signIn: () => void;
  readonly signOut: () => void;
  readonly savePasted: (cookie: string) => void;
  readonly saving: boolean;
}

export function useSourceSession(source: SourceSummary): SourceSessionView {
  const connection = useBackendConnection();
  const queryClient = useQueryClient();
  const toast = useToast();

  const session = useQuery({
    queryKey: sessionQueryKey(source.key),
    queryFn: async () => getSourceSession(connection, source.key),
  });

  const invalidate = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: sessionQueryKey(source.key) });
  };

  const complain = (cause: unknown): void => {
    const problem = cause as ApiProblem;
    toast.show({
      tone: 'danger',
      title: isApiProblem(cause) ? problem.title : 'That did not work',
      description: isApiProblem(cause) ? (problem.detail ?? '') : String(cause),
    });
  };

  const succeeded = async (): Promise<void> => {
    toast.show({
      tone: 'success',
      title: `Signed in to ${source.name}`,
      description: 'Your session is used read-only, on that site’s pages only.',
    });
    await invalidate();
  };

  const store = useMutation({
    mutationFn: async (input: { cookie: string; via: 'PASTE' | 'LOGIN_WINDOW' }) =>
      setSourceSession(connection, source.key, input.cookie, input.via),
    onSuccess: succeeded,
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

  /**
   * What the window's own `signin://finished` does: read its cookies, and store
   * them if there are any.
   *
   * Closing the window without signing in reaches here too, which is why an
   * empty capture is a plain sentence rather than an error — the professor
   * changed their mind, and nothing went wrong.
   */
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
        return undefined;
      }
      return setSourceSession(connection, source.key, result.cookie, 'LOGIN_WINDOW');
    },
    onSuccess: async (stored) => {
      if (stored === undefined) {
        toast.show({
          tone: 'info',
          title: `Not signed in to ${source.name}`,
          description: 'The window closed before you were signed in. Nothing was stored.',
        });
        return;
      }
      await succeeded();
    },
    onError: complain,
  });

  // The listener is registered once per card and reads the latest `capture`
  // through a ref, so re-rendering does not tear the subscription down and miss
  // the one event it exists for.
  const onFinished = useRef(capture.mutate);
  useEffect(() => {
    onFinished.current = capture.mutate;
  });

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void onSignInFinished((finished) => {
      if (finished.sourceKey === source.key) {
        onFinished.current();
      }
    }).then((stop) => {
      if (cancelled) {
        stop();
      } else {
        unlisten = stop;
      }
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [source.key]);

  return {
    status: session.data,
    supported: session.data?.supported === true,
    signingIn: signIn.isPending || capture.isPending,
    signIn: signIn.mutate,
    signOut: signOut.mutate,
    savePasted: (cookie) => {
      store.mutate({ cookie, via: 'PASTE' });
    },
    saving: store.isPending,
  };
}
