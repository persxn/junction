import type { BackendConnection, SetupStatus } from '@compintel/contracts';
import { useCallback, useEffect, useState } from 'react';

import { fetchSetupStatus } from '../../api/setup.js';

/**
 * Whether this installation still needs the wizard (ruling R39).
 *
 * It is the first thing the app asks after the backend says READY, because
 * until it has an answer there is nothing sensible to show: a login screen on a
 * fresh install is a dead end, and the wizard on a configured one is a way to
 * lose data. Both wrong screens are avoided by waiting for one cheap call.
 */

export type SetupState =
  | { readonly kind: 'LOADING' }
  | { readonly kind: 'READY'; readonly status: SetupStatus }
  /** The call itself failed; the caller shows the connection screen instead. */
  | { readonly kind: 'FAILED'; readonly error: unknown };

export interface SetupStatusView {
  readonly state: SetupState;
  /** Re-reads after the wizard finishes, which is what closes the gate. */
  readonly refresh: () => void;
}

export function useSetupStatus(connection: BackendConnection | undefined): SetupStatusView {
  const [state, setState] = useState<SetupState>({ kind: 'LOADING' });
  const [generation, setGeneration] = useState(0);

  const refresh = useCallback((): void => {
    setState({ kind: 'LOADING' });
    setGeneration((value) => value + 1);
  }, []);

  useEffect(() => {
    if (connection === undefined) {
      return;
    }
    let cancelled = false;
    void fetchSetupStatus(connection).then(
      (status) => {
        if (!cancelled) {
          setState({ kind: 'READY', status });
        }
      },
      (error: unknown) => {
        if (!cancelled) {
          setState({ kind: 'FAILED', error });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [connection, generation]);

  return { state, refresh };
}
