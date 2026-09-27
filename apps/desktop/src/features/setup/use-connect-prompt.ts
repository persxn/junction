import type { SourceSummary } from '@compintel/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  CONNECT_PROMPT_KEY,
  fetchConnectPrompt,
  listSources,
  markConnectPromptSeen,
} from '../../api/admin-sources.js';
import { useBackendConnection } from '../../shell/connection-context.js';

/**
 * The state behind the one-time "Connect your sources" step (R74's product flow).
 *
 * The step is offered once per installation and the flag lives in the backend's
 * settings, not in this window: a professor who closes the app halfway through
 * signing in to Devfolio should be offered the rest, and a second window must
 * not offer it again. So "is it owed" is a query, "it is done" is a mutation, and
 * nothing about it is remembered locally.
 *
 * It lists the sources the step is about, which is the intersection of what the
 * backend says may hold a session (R74: Devfolio, Unstop) and what `GET /sources`
 * returns — the second is what `SessionCard` needs to render anything at all.
 */

export interface ConnectPromptView {
  /** True while the step has not been finished or skipped on this installation. */
  readonly pending: boolean;
  /** Still deciding; the gate shows nothing rather than flashing the step. */
  readonly isLoading: boolean;
  /** The sources the step offers, in `GET /sources` order. */
  readonly sources: readonly SourceSummary[];
  /** "I have signed in" and "Skip for now" are the same call (R74). */
  readonly finish: () => void;
  readonly isFinishing: boolean;
}

export function useConnectPrompt(enabled: boolean): ConnectPromptView {
  const connection = useBackendConnection();
  const queryClient = useQueryClient();

  const prompt = useQuery({
    queryKey: CONNECT_PROMPT_KEY,
    queryFn: async () => fetchConnectPrompt(connection),
    enabled,
    // It changes once, by this window's own action, so there is nothing to poll.
    staleTime: Infinity,
  });

  const sources = useQuery({
    queryKey: ['admin', 'sources'],
    queryFn: async () => listSources(connection),
    enabled: enabled && prompt.data !== undefined,
  });

  const finish = useMutation({
    mutationFn: async () => markConnectPromptSeen(connection),
    onSuccess: (answer) => {
      // The answer *is* the new state, so the gate closes without another round
      // trip; a refetch here would leave the step on screen for a moment longer.
      queryClient.setQueryData(CONNECT_PROMPT_KEY, answer);
    },
  });

  const keys = new Set(prompt.data?.keys ?? []);
  return {
    pending: prompt.data?.pending === true,
    isLoading: enabled && (prompt.isPending || sources.isPending),
    sources: (sources.data ?? []).filter((source) => keys.has(source.key)),
    finish: finish.mutate,
    isFinishing: finish.isPending,
  };
}
