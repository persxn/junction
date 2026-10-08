import type { CompetitionDetail } from '@compintel/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { isApiProblem } from '../../api/problem.js';
import { useToast } from '../../components/toast/ToastProvider.js';
import {
  COMPETITIONS_KEY,
  competitionKey,
  CONFLICT_TEXT,
  problemText,
} from './use-competition-actions.js';

/**
 * The Competition page's writes other than status moves: roster, mentors and
 * notes. Same shape as the Team page's — optimistic where asked, the server's
 * answer replaces the page, a failure puts it back and says why, a stale
 * version offers a reload.
 */

export interface CompetitionWrite {
  readonly competition: CompetitionDetail;
  readonly failure: string;
  readonly call: (version: number) => Promise<CompetitionDetail>;
  readonly optimistic?: (current: CompetitionDetail) => CompetitionDetail;
}

export function useCompetitionWrites(): (
  write: CompetitionWrite,
) => Promise<CompetitionDetail | undefined> {
  const client = useQueryClient();
  const toast = useToast();
  return useCallback(
    async ({ competition, failure, call, optimistic }: CompetitionWrite) => {
      const key = competitionKey(competition.id);
      if (optimistic !== undefined) client.setQueryData(key, optimistic(competition));
      try {
        const saved = await call(competition.version);
        client.setQueryData(key, saved);
        void client.invalidateQueries({ queryKey: [...COMPETITIONS_KEY, 'list'] });
        void client.invalidateQueries({ queryKey: ['teams'] });
        void client.invalidateQueries({ queryKey: ['students'] });
        return saved;
      } catch (cause) {
        client.setQueryData(key, competition);
        const stale = isApiProblem(cause) && cause.code === 'ENGAGEMENT_VERSION_CONFLICT';
        toast.show({
          tone: stale ? 'warning' : 'danger',
          title: stale ? 'Someone else changed this competition' : failure,
          description: stale ? CONFLICT_TEXT : problemText(cause),
          ...(stale
            ? {
                action: {
                  label: 'Reload',
                  onAction: () => {
                    void client.invalidateQueries({ queryKey: key });
                  },
                },
              }
            : {}),
        });
        return undefined;
      }
    },
    [client, toast],
  );
}
