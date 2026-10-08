import type { InitialStatus } from '@compintel/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ArrowLeft, ArrowRight, Lightbulb, UserPlus } from 'lucide-react';
import { useState } from 'react';

import { assignCompetition } from '../../../api/competitions.js';
import { isApiProblem } from '../../../api/problem.js';
import { Dialog } from '../../../components/Dialog.js';
import { useToast } from '../../../components/toast/ToastProvider.js';
import { useBackendConnection } from '../../../shell/connection-context.js';
import {
  emptyDraft,
  requestOf,
  stepLabel,
  type AssignDraft,
  type AssignStep,
} from './assign-model.js';
import { ASSIGN_STEPS } from './steps.js';

/**
 * The assign dialog (§16.2, R98): its steps come from the array, so "Step 1 of
 * 3" and the request both follow it. Confirm ends in a toast with "Open
 * competition"; there is no Undo — withdrawing is the reversal.
 */

export interface AssignDialogProps {
  readonly event: { readonly id: string; readonly title: string };
  readonly onClose: () => void;
  /** A test seam: another array of steps (WP-20a's insertion). */
  readonly steps?: readonly AssignStep[];
}

export function AssignDialog({
  event,
  onClose,
  steps = ASSIGN_STEPS,
}: AssignDialogProps): React.JSX.Element {
  const connection = useBackendConnection();
  const client = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState<AssignDraft>(() => emptyDraft(event.id, event.title));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const step = steps[index];
  if (step === undefined) throw new Error('the assign flow has no steps');
  const last = index === steps.length - 1;
  const Body = step.Component;

  const submit = (initialStatus: InitialStatus): void => {
    setBusy(true);
    setError(undefined);
    assignCompetition(connection, requestOf(draft, steps, initialStatus)).then(
      (result) => {
        void client.invalidateQueries({ queryKey: ['competitions'] });
        void client.invalidateQueries({ queryKey: ['teams'] });
        void client.invalidateQueries({ queryKey: ['students'] });
        const first = result.competitions[0];
        const count = result.competitions.length;
        toast.show({
          tone: 'success',
          title:
            count === 1
              ? `${initialStatus === 'ASSIGNED' ? 'Assigned' : 'Now considering'} “${event.title}”`
              : `${String(count)} competitions created for “${event.title}”`,
          ...(first === undefined
            ? {}
            : {
                action: {
                  label: 'Open competition',
                  onAction: () => {
                    void navigate({
                      to: '/competitions/$competitionId',
                      params: { competitionId: first.id },
                    });
                  },
                },
              }),
        });
        onClose();
      },
      (cause: unknown) => {
        setBusy(false);
        setError(
          isApiProblem(cause) ? (cause.detail ?? cause.title) : 'The local service did not answer.',
        );
      },
    );
  };

  return (
    <Dialog title={`Assign “${event.title}”`} onClose={onClose} width="max-w-xl">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-fg-muted">
          <span className="font-medium text-fg">{stepLabel(index, steps)}</span> — {step.title}
        </p>
        <ol aria-label="Steps" className="flex gap-2 text-xs text-fg-muted">
          {steps.map((item, position) => (
            <li
              key={item.id}
              aria-current={position === index ? 'step' : undefined}
              className={`rounded-full border px-2 py-0.5 ${position === index ? 'border-accent text-fg' : 'border-line'}`}
            >
              {item.title}
            </li>
          ))}
        </ol>
        <Body
          draft={draft}
          onChange={(patch) => {
            setDraft((current) => ({ ...current, ...patch }));
          }}
        />
        {error !== undefined && (
          <p role="alert" className="rounded-md bg-danger-surface p-3 text-sm">
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-between gap-2">
          <button
            type="button"
            onClick={
              index === 0
                ? onClose
                : () => {
                    setIndex(index - 1);
                  }
            }
            className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 hover:bg-surface-hover"
          >
            {index > 0 && <ArrowLeft aria-hidden="true" className="size-4" />}
            {index === 0 ? 'Cancel' : 'Back'}
          </button>
          {last ? (
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  submit('CONSIDERING');
                }}
                className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 hover:bg-surface-hover disabled:opacity-60"
              >
                <Lightbulb aria-hidden="true" className="size-4" />
                Just considering
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  submit('ASSIGNED');
                }}
                className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 font-medium text-on-accent hover:bg-accent-hover disabled:opacity-60"
              >
                <UserPlus aria-hidden="true" className="size-4" />
                Assign
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={!step.isComplete(draft)}
              onClick={() => {
                setIndex(index + 1);
              }}
              className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 font-medium text-on-accent hover:bg-accent-hover disabled:opacity-50"
            >
              Next
              <ArrowRight aria-hidden="true" className="size-4" />
            </button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
