import type { CompetitionDetail } from '@compintel/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Medal, Pencil, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';

import { removeOutcome, saveOutcome } from '../../api/outcomes.js';
import { isApiProblem } from '../../api/problem.js';
import { useToast } from '../../components/toast/ToastProvider.js';
import { openExternal } from '../../lib/external.js';
import { useBackendConnection } from '../../shell/connection-context.js';
import {
  COMPETITIONS_KEY,
  competitionKey,
  problemText,
} from '../competitions/use-competition-actions.js';
import { ResourceRows } from '../resources/ResourceRows.js';
import { resourcesKey } from '../resources/ResourcesScope.js';
import { dayText } from '../students/labels.js';
import { ConfirmRemoveDialog } from '../workflows/StageDialogs.js';
import { OutcomeBadge } from './OutcomeBadge.js';
import { OutcomeDialog } from './OutcomeDialog.js';
import { canRecordOutcome, formatPrize, recordBlockedReason } from './outcome-model.js';

/**
 * The Competition page's outcome panel (§16.2, R104, WP-21): "Record outcome"
 * only where it is allowed — otherwise the reason — and once recorded, the
 * result as icon + label, rank, prize with its amount in its own currency,
 * the certificate and other files (WP-20b's rows: Open, Show in Explorer),
 * the result link, notes, feedback and who recorded it.
 */

const BUTTON =
  'flex items-center gap-1 rounded-md border border-line px-2 py-1 text-sm hover:bg-surface-hover';

export function OutcomePanel({
  competition,
}: {
  readonly competition: CompetitionDetail;
}): React.JSX.Element {
  const headingId = useId();
  const connection = useBackendConnection();
  const client = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const outcome = competition.outcome;
  const allowed = canRecordOutcome(competition);
  const reason = recordBlockedReason(competition.status);

  const refresh = (): void => {
    void client.invalidateQueries({ queryKey: competitionKey(competition.id) });
    void client.invalidateQueries({ queryKey: [...COMPETITIONS_KEY, 'list'] });
    void client.invalidateQueries({ queryKey: resourcesKey(competition.id) });
    void client.invalidateQueries({ queryKey: ['students'] });
  };

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h2 id={headingId} className="text-md">
        Outcome
      </h2>
      {outcome === null ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-dashed border-line p-3 text-sm">
          <Medal aria-hidden="true" className="size-4 text-fg-muted" />
          <span className="text-fg-muted">
            {allowed
              ? 'No outcome recorded yet.'
              : (reason ?? 'Only this competition’s mentors record its outcome.')}
          </span>
          {allowed && (
            <button
              type="button"
              onClick={() => {
                setEditing(true);
              }}
              className="rounded-md bg-accent px-3 py-1.5 font-medium text-on-accent hover:bg-accent-hover"
            >
              Record outcome
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2 rounded-md border border-line p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-md font-medium">
              <OutcomeBadge result={outcome.result} rank={outcome.rank} />
            </span>
            {allowed && (
              <div className="flex gap-2">
                <button
                  type="button"
                  className={BUTTON}
                  onClick={() => {
                    setEditing(true);
                  }}
                >
                  <Pencil aria-hidden="true" className="size-4" />
                  Edit outcome
                </button>
                <button
                  type="button"
                  className={BUTTON}
                  onClick={() => {
                    setRemoving(true);
                  }}
                >
                  <Trash2 aria-hidden="true" className="size-4" />
                  Remove outcome
                </button>
              </div>
            )}
          </div>
          {(outcome.prizeText !== null || outcome.prizeMinor !== null) && (
            <p>
              Prize: {outcome.prizeText}
              {outcome.prizeMinor !== null && outcome.prizeCurrency !== null && (
                <span>
                  {outcome.prizeText === null ? '' : ' · '}
                  {formatPrize(outcome.prizeMinor, outcome.prizeCurrency)}
                </span>
              )}
            </p>
          )}
          {outcome.resultUrl !== null && (
            <button
              type="button"
              className={`${BUTTON} w-fit`}
              onClick={() => {
                void openExternal(outcome.resultUrl ?? '');
              }}
            >
              <ExternalLink aria-hidden="true" className="size-4" />
              Open the result announcement
            </button>
          )}
          {outcome.notes !== null && <p className="whitespace-pre-line">{outcome.notes}</p>}
          {outcome.feedback !== null && (
            <p className="whitespace-pre-line text-fg-muted">Feedback: {outcome.feedback}</p>
          )}
          <ResourceRows
            ownerKind="OUTCOME"
            ownerId={competition.id}
            ownerName="the outcome"
            title="Certificate and files"
            headingLevel={3}
          />
          <p className="text-xs text-fg-muted">
            Recorded by {outcome.recordedBy} on {dayText(outcome.recordedAt)}
          </p>
        </div>
      )}
      {editing && (
        <OutcomeDialog
          title={outcome === null ? 'Record the outcome' : 'Edit the outcome'}
          current={outcome}
          onClose={() => {
            setEditing(false);
          }}
          onSubmit={async (input) => {
            try {
              await saveOutcome(connection, competition.id, input);
              refresh();
              toast.show({
                tone: 'success',
                title: outcome === null ? 'Outcome recorded' : 'Outcome saved',
              });
              return undefined;
            } catch (cause) {
              if (isApiProblem(cause) && cause.code === 'OUTCOME_VERSION_CONFLICT') refresh();
              return problemText(cause);
            }
          }}
        />
      )}
      {removing && outcome !== null && (
        <ConfirmRemoveDialog
          what="the outcome"
          detail="The competition stays completed; its certificate and files stay too."
          onAnswer={(yes) => {
            setRemoving(false);
            if (!yes) return;
            void removeOutcome(connection, competition.id, outcome.version).then(
              refresh,
              (cause: unknown) => {
                toast.show({
                  tone: 'danger',
                  title: 'The outcome was not removed',
                  description: problemText(cause),
                });
              },
            );
          }}
        />
      )}
    </section>
  );
}
