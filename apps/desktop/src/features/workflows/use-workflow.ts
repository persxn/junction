import type { WorkflowView } from '@compintel/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { isApiProblem } from '../../api/problem.js';
import { getWorkflow, workflowWrite } from '../../api/workflows.js';
import { useToast } from '../../components/toast/ToastProvider.js';
import { useBackendConnection } from '../../shell/connection-context.js';
import { COMPETITIONS_KEY, problemText } from '../competitions/use-competition-actions.js';

/**
 * A competition's workflow and its writes (WP-20a step 7). Every write answers
 * with the whole view, which replaces the page; an optimistic copy is shown
 * first where asked. A stale version offers a reload in the house words; any
 * other refusal puts the page back and says why.
 */

export const workflowKey = (competitionId: string) => ['workflows', competitionId] as const;

export const STALE_TEXT = 'Someone else changed this — reload to see their change.';

export function useWorkflow(competitionId: string, enabled = true) {
  const connection = useBackendConnection();
  return useQuery({
    queryKey: workflowKey(competitionId),
    queryFn: () => getWorkflow(connection, competitionId),
    enabled,
    retry: false,
  });
}

export interface WorkflowWrite {
  readonly view: WorkflowView;
  /** Under `/competitions/:id/workflow/`. */
  readonly path: string;
  readonly body: Record<string, unknown>;
  readonly method?: 'POST' | 'PATCH' | 'PUT';
  readonly failure: string;
  readonly optimistic?: WorkflowView;
}

export type RunWrite = (write: WorkflowWrite) => Promise<WorkflowView | undefined>;

export function useWorkflowWrites(): RunWrite {
  const connection = useBackendConnection();
  const client = useQueryClient();
  const toast = useToast();
  return useCallback(
    async ({ view, path, body, method = 'POST', failure, optimistic }: WorkflowWrite) => {
      const key = workflowKey(view.competitionId);
      if (optimistic !== undefined) client.setQueryData(key, optimistic);
      try {
        const saved = await workflowWrite(connection, view.competitionId, path, body, method);
        client.setQueryData(key, saved);
        // The board and the list show progress and health.
        void client.invalidateQueries({ queryKey: [...COMPETITIONS_KEY, 'list'] });
        return saved;
      } catch (cause) {
        client.setQueryData(key, view);
        const stale = isApiProblem(cause) && cause.code === 'WORKFLOW_VERSION_CONFLICT';
        toast.show({
          tone: stale ? 'warning' : 'danger',
          title: stale ? 'Someone else changed this' : failure,
          description: stale ? STALE_TEXT : problemText(cause),
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
    [client, connection, toast],
  );
}
