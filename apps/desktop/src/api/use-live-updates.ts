import type { BackendConnection } from '@compintel/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { useToast } from '../components/toast/ToastProvider.js';
import { SOURCE_STATUS_KEY } from './event-detail.js';
import { NOTIFICATIONS_KEY } from './notifications.js';
import { openStream, POLL_INTERVAL_MS, type StreamUnavailableReason } from './stream.js';

/**
 * Live updates, and what to do when there are none (rulings R30 and R36).
 *
 * The happy path is one SSE connection whose events drive TanStack Query's
 * invalidation, exactly as §4.2 describes: `data.invalidated` for a domain that
 * changed, and `source.run.finished` for the freshness pill (R86). The unhappy
 * path is
 * ruling R30: the shell's fallback transport cannot carry a stream, so rather
 * than failing, the app says "live updates unavailable" once and falls back to
 * re-reading on a timer. Stale data that is honest about being stale beats an
 * error screen on a machine where everything else works.
 */

export interface LiveUpdatesOptions {
  readonly connection: BackendConnection | undefined;
  /** Only run while somebody is signed in and unlocked. */
  readonly enabled: boolean;
  /** The poll, and what a reconnect calls to re-check the session. */
  readonly refresh: () => Promise<void>;
  /** Test seam. */
  readonly pollIntervalMs?: number;
}

export interface LiveUpdatesView {
  /** Why live updates are off, or `undefined` while the stream is running. */
  readonly unavailable: StreamUnavailableReason | undefined;
}

const NOTICE: Record<StreamUnavailableReason, string> = {
  NO_TRANSPORT: 'This machine blocks the live connection, so CompIntel re-checks every 30 seconds.',
  DISCONNECTED: 'The live connection dropped. CompIntel is reconnecting and re-checking meanwhile.',
  UNAUTHENTICATED: 'The live connection was refused because the session ended.',
};

export function useLiveUpdates(options: LiveUpdatesOptions): LiveUpdatesView {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [unavailable, setUnavailable] = useState<StreamUnavailableReason | undefined>(undefined);

  const refresh = useRef(options.refresh);
  const noticeId = useRef<string | undefined>(undefined);

  // Declared before the effects that read it, so the poll below always calls the
  // caller's latest `refresh` — and written in an effect, never during a render.
  useEffect(() => {
    refresh.current = options.refresh;
  });

  const { connection, enabled } = options;

  useEffect(() => {
    if (!enabled || connection === undefined) {
      return;
    }
    const subscription = openStream(
      { connection },
      {
        onEvent: (event) => {
          if (event.type === 'data.invalidated') {
            const domain = event.payload.domain;
            void queryClient.invalidateQueries(
              typeof domain === 'string' ? { queryKey: [domain] } : undefined,
            );
          }
          // R86: a run ended, so the freshness pill is out of date. Only the
          // status query is re-read — a finished run says nothing about the
          // events on screen, and WP-09a's linker publishes `data.invalidated`
          // for those when it has actually written something.
          if (event.type === 'source.run.finished') {
            void queryClient.invalidateQueries({ queryKey: SOURCE_STATUS_KEY });
          }
          // WP-23: ids only (R36); the bell, the Inbox and the toasts re-read.
          if (event.type === 'notification.created' || event.type === 'notification.updated') {
            void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
          }
        },
        onOpen: () => {
          // Anything could have changed while the stream was down.
          void queryClient.invalidateQueries();
        },
        onUnavailable: setUnavailable,
      },
    );
    return () => {
      subscription.close();
    };
  }, [connection, enabled, queryClient]);

  // The R30 fallback: while there is no stream, re-read on a timer.
  useEffect(() => {
    if (!enabled || unavailable === undefined || unavailable === 'UNAUTHENTICATED') {
      return;
    }
    const timer = setInterval(() => {
      void refresh.current();
      void queryClient.invalidateQueries();
    }, options.pollIntervalMs ?? POLL_INTERVAL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [enabled, unavailable, queryClient, options.pollIntervalMs]);

  // …and say so, once, rather than silently going stale.
  useEffect(() => {
    if (unavailable === undefined) {
      if (noticeId.current !== undefined) {
        toast.dismiss(noticeId.current);
        noticeId.current = undefined;
      }
      return;
    }
    noticeId.current ??= toast.show({
      tone: 'warning',
      title: 'Live updates unavailable',
      description: NOTICE[unavailable],
      // It stays until the stream comes back or the user dismisses it.
      durationMs: 0,
    });
  }, [unavailable, toast]);

  return { unavailable };
}
