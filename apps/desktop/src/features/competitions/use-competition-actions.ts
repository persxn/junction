import {
  ENGAGEMENT_STATUS_LABELS,
  type CompetitionDetail,
  type CompetitionListItem,
  type CompetitionListResponse,
  type EngagementStatus,
} from '@compintel/contracts';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useCallback, useMemo, type ReactNode } from 'react';

import { transitionCompetition } from '../../api/competitions.js';
import { isApiProblem } from '../../api/problem.js';
import { useToast } from '../../components/toast/ToastProvider.js';
import { useBackendConnection } from '../../shell/connection-context.js';
import { useWorkflowChoice } from '../workflows/use-workflow-choice.js';
import { undoable, whoOf } from './board-model.js';

/**
 * Status moves (R97) from the board, the list and the page. The card moves at
 * once and the server is asked second; a refusal puts it back and hands the
 * problem's `detail` to the caller to show inline. Success says so, with Undo
 * only where the reverse move is allowed (Considering ↔ Assigned).
 * Considering → Assigned first asks for the workflow (WP-20a); cancelling it
 * moves nothing.
 */

export const COMPETITIONS_KEY = ['competitions'] as const;
export const competitionKey = (id: string) => ['competitions', 'detail', id] as const;

export const CONFLICT_TEXT = 'Someone else changed this competition — reload to see their changes.';

export type MoveResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string }
  /** The person closed the workflow step: nothing moved and there is nothing to say. */
  | { readonly ok: false; readonly cancelled: true };

export interface CompetitionActions {
  readonly move: (
    item: CompetitionListItem,
    to: EngagementStatus,
    options?: { readonly offerUndo?: boolean },
  ) => Promise<MoveResult>;
  /** The workflow step's dialog; the page renders it. */
  readonly dialog: ReactNode;
}

export function problemText(cause: unknown): string {
  if (!isApiProblem(cause)) return 'The local service did not answer.';
  if (cause.code === 'ENGAGEMENT_VERSION_CONFLICT') return CONFLICT_TEXT;
  return cause.detail ?? cause.title;
}

export function useCompetitionActions(): CompetitionActions {
  const client = useQueryClient();
  const connection = useBackendConnection();
  const toast = useToast();
  const choice = useWorkflowChoice();
  const { ask } = choice;

  const patchLists = useCallback(
    (id: string, status: EngagementStatus): [QueryKey, unknown][] => {
      const snapshot = client.getQueriesData({ queryKey: [...COMPETITIONS_KEY, 'list'] });
      client.setQueriesData<CompetitionListResponse>(
        { queryKey: [...COMPETITIONS_KEY, 'list'] },
        (current) =>
          current === undefined
            ? current
            : {
                ...current,
                items: current.items.map((row) => (row.id === id ? { ...row, status } : row)),
              },
      );
      return snapshot;
    },
    [client],
  );

  const move = useCallback(
    (
      item: CompetitionListItem,
      to: EngagementStatus,
      options: { readonly offerUndo?: boolean } = {},
    ): Promise<MoveResult> => {
      // A named inner function, so Undo can call it again without the hook
      // referring to itself.
      const run = async (
        current: CompetitionListItem,
        target: EngagementStatus,
        offerUndo: boolean,
      ): Promise<MoveResult> => {
        const from = current.status;
        let workflow;
        if (from === 'CONSIDERING' && target === 'ASSIGNED') {
          const answer = await ask(current);
          if (!answer.proceed) return { ok: false, cancelled: true };
          workflow = answer.workflow;
        }
        const snapshot = patchLists(current.id, target);
        try {
          const saved: CompetitionDetail = await transitionCompetition(
            connection,
            current.id,
            target,
            current.version,
            workflow === undefined ? {} : { workflow },
          );
          client.setQueryData(competitionKey(current.id), saved);
          void client.invalidateQueries({ queryKey: COMPETITIONS_KEY });
          void client.invalidateQueries({ queryKey: ['teams'] });
          void client.invalidateQueries({ queryKey: ['students'] });
          toast.show({
            tone: 'success',
            title: `${whoOf(current)} — ${ENGAGEMENT_STATUS_LABELS[target]}`,
            ...(offerUndo && undoable(from, target)
              ? {
                  action: {
                    label: 'Undo',
                    onAction: () => {
                      void run(saved, from, false);
                    },
                  },
                }
              : {}),
          });
          return { ok: true };
        } catch (cause) {
          for (const [key, data] of snapshot) client.setQueryData(key, data);
          return { ok: false, message: problemText(cause) };
        }
      };
      return run(item, to, options.offerUndo !== false);
    },
    [ask, client, connection, patchLists, toast],
  );

  return useMemo(() => ({ move, dialog: choice.dialog }), [move, choice.dialog]);
}
