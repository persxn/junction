import type { CompetitionListItem, WorkflowChoiceInput } from '@compintel/contracts';
import { useCallback, useMemo, useState, type ReactNode } from 'react';

import { isApiProblem } from '../../api/problem.js';
import { getWorkflow } from '../../api/workflows.js';
import { useBackendConnection } from '../../shell/connection-context.js';
import { WorkflowChoiceDialog } from './WorkflowChoiceDialog.js';

/**
 * Asks for the workflow before a Considering → Assigned move (WP-20a step 6).
 * A competition that already has one — assigned before, then moved back — is
 * not asked again: the server keeps the first copy.
 */

export type WorkflowAnswer =
  | { readonly proceed: true; readonly workflow: WorkflowChoiceInput | undefined }
  | { readonly proceed: false };

export interface WorkflowChoice {
  readonly ask: (item: CompetitionListItem) => Promise<WorkflowAnswer>;
  /** Render it where the hook is used. */
  readonly dialog: ReactNode;
}

interface Pending {
  readonly item: CompetitionListItem;
  readonly resolve: (answer: WorkflowAnswer) => void;
}

export function useWorkflowChoice(): WorkflowChoice {
  const connection = useBackendConnection();
  const [pending, setPending] = useState<Pending | undefined>(undefined);

  const ask = useCallback(
    async (item: CompetitionListItem): Promise<WorkflowAnswer> => {
      try {
        await getWorkflow(connection, item.id);
        return { proceed: true, workflow: undefined };
      } catch (cause) {
        // Anything but "no workflow yet" is the server's to answer on the move itself.
        if (!isApiProblem(cause) || cause.code !== 'WORKFLOW_NOT_FOUND') {
          return { proceed: true, workflow: undefined };
        }
      }
      return new Promise<WorkflowAnswer>((resolve) => {
        setPending({ item, resolve });
      });
    },
    [connection],
  );

  const dialog = useMemo(
    () =>
      pending === undefined ? null : (
        <WorkflowChoiceDialog
          key={pending.item.id}
          item={pending.item}
          onDone={(choice) => {
            setPending(undefined);
            pending.resolve(
              choice === undefined ? { proceed: false } : { proceed: true, workflow: choice },
            );
          }}
        />
      ),
    [pending],
  );

  return useMemo(() => ({ ask, dialog }), [ask, dialog]);
}
