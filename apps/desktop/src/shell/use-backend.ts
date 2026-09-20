import type { BackendConnection, BackendStatus, HealthResponse } from '@compintel/contracts';
import { useCallback, useEffect, useState } from 'react';

import { backendConnection, backendStatus, fetchHealth, onBackendStatus } from './backend.js';

export interface BackendView {
  readonly status: BackendStatus | undefined;
  readonly connection: BackendConnection | undefined;
  readonly health: HealthResponse | undefined;
  /** The last thing that went wrong while talking to the shell or the API. */
  readonly error: string | undefined;
  readonly refresh: () => void;
}

/** What one generation of the backend told us; discarded when it restarts. */
interface Loaded {
  readonly generation: number;
  readonly connection: BackendConnection;
  readonly health: HealthResponse;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Keeps the UI in step with the supervised backend: one initial read, then the
 * shell's own status events. The connection is keyed by `generation`, so when the
 * backend restarts the previous spawn's client secret and health simply stop being
 * rendered - no clearing, no window where a dead secret looks current (A2).
 */
export function useBackend(): BackendView {
  const [status, setStatus] = useState<BackendStatus | undefined>(undefined);
  const [loaded, setLoaded] = useState<Loaded | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => {
    setNonce((value) => value + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const unlisten = onBackendStatus((next) => {
      if (!cancelled) {
        setStatus(next);
      }
    });
    backendStatus().then(
      (next) => {
        if (!cancelled) {
          setStatus(next);
        }
      },
      (cause: unknown) => {
        if (!cancelled) {
          setError(messageOf(cause));
        }
      },
    );
    return () => {
      cancelled = true;
      void unlisten.then((stop) => {
        stop();
      });
    };
  }, []);

  // 0 means "there is nothing to connect to", which is also true while the
  // backend is starting, restarting or has given up.
  const generation = status?.phase === 'READY' ? status.generation : 0;

  useEffect(() => {
    if (generation === 0) {
      return;
    }
    let cancelled = false;
    const load = async (): Promise<void> => {
      const connection = await backendConnection();
      const health = await fetchHealth(connection);
      if (!cancelled) {
        setLoaded({ generation, connection, health });
        setError(undefined);
      }
    };
    load().catch((cause: unknown) => {
      if (!cancelled) {
        setError(messageOf(cause));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [generation, nonce]);

  const current = loaded?.generation === generation ? loaded : undefined;
  return {
    status,
    connection: current?.connection,
    health: current?.health,
    error,
    refresh,
  };
}
