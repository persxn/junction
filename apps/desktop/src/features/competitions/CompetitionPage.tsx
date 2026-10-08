import { ENGAGEMENT_STATUS_LABELS, type CompetitionDetail } from '@compintel/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { ArrowLeft, CircleAlert, Medal, Trophy } from 'lucide-react';
import { useState } from 'react';

import { getCompetition, updateCompetitionNotes } from '../../api/competitions.js';
import { isApiProblem } from '../../api/problem.js';
import { EmptyState } from '../../components/EmptyState.js';
import { Guide } from '../../components/Guide.js';
import { Skeleton } from '../../components/Skeleton.js';
import { useNow } from '../../lib/use-now.js';
import { useBackendConnection } from '../../shell/connection-context.js';
import { DEFAULT_SEARCH } from '../discover/search-state.js';
import { CompetitionResources } from '../resources/CompetitionResources.js';
import { ResourcesScope } from '../resources/ResourcesScope.js';
import { WorkflowSection } from '../workflows/WorkflowSection.js';
import { dayText } from '../students/labels.js';
import { whoOf } from './board-model.js';
import { CompetitionMentors } from './CompetitionMentors.js';
import { CompetitionStatus, KIND_LABELS } from './labels.js';
import { MoveMenu } from './MoveMenu.js';
import { NextDeadline } from './NextDeadline.js';
import { RosterSection } from './RosterSection.js';
import { DEFAULT_COMPETITIONS_SEARCH } from './search-state.js';
import { competitionKey, useCompetitionActions } from './use-competition-actions.js';
import { useCompetitionWrites } from './use-competition-writes.js';

/**
 * The Competition page (§16.2, WP-19 step 6): who is taking part in which
 * event, the status with "Move to…", the history in words, the roster, the
 * mentors and notes; WP-20a's stages, tasks, progress and health. Outcome is
 * WP-21's; until then its panel says what will fill it.
 */

function Later(props: {
  readonly id: string;
  readonly title: string;
  readonly text: string;
  readonly icon: typeof Trophy;
}): React.JSX.Element {
  const Icon = props.icon;
  return (
    <section aria-labelledby={props.id} className="flex flex-col gap-2">
      <h2 id={props.id} className="text-md">
        {props.title}
      </h2>
      <p className="flex items-start gap-2 rounded-md border border-dashed border-line p-3 text-sm text-fg-muted">
        <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        {props.text}
      </p>
    </section>
  );
}

function History({ competition }: { readonly competition: CompetitionDetail }): React.JSX.Element {
  return (
    <section aria-labelledby="history-heading" className="flex flex-col gap-2">
      <h2 id="history-heading" className="text-md">
        History
      </h2>
      <ol className="flex flex-col gap-1 text-sm">
        {competition.history.map((change) => (
          <li key={change.id}>
            <span className="text-fg-muted">{dayText(change.changedAt)} · </span>
            {change.from === null
              ? `${change.changedBy} started it as ${ENGAGEMENT_STATUS_LABELS[change.to]}`
              : `${change.changedBy} moved it from ${ENGAGEMENT_STATUS_LABELS[change.from]} to ${ENGAGEMENT_STATUS_LABELS[change.to]}`}
            {change.note !== null && <span className="text-fg-muted"> — “{change.note}”</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Notes({ competition }: { readonly competition: CompetitionDetail }): React.JSX.Element {
  const connection = useBackendConnection();
  const write = useCompetitionWrites();
  const [text, setText] = useState(competition.notes ?? '');
  const changed = text !== (competition.notes ?? '');
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void write({
          competition,
          failure: 'The notes were not saved',
          call: (version) =>
            updateCompetitionNotes(
              connection,
              competition.id,
              text.trim() === '' ? null : text,
              version,
            ),
        });
      }}
    >
      <label htmlFor="competition-notes" className="text-md font-medium">
        Notes
      </label>
      <textarea
        id="competition-notes"
        rows={4}
        value={text}
        disabled={!competition.can.edit}
        onChange={(event) => {
          setText(event.target.value);
        }}
        className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm disabled:cursor-not-allowed"
      />
      <button
        type="submit"
        disabled={!competition.can.edit || !changed}
        className="w-fit rounded-md border border-line px-3 py-1.5 text-sm hover:bg-surface-hover disabled:opacity-50"
      >
        Save notes
      </button>
    </form>
  );
}

export function CompetitionPage(): React.JSX.Element {
  const { competitionId } = useParams({ from: '/competitions/$competitionId' });
  const connection = useBackendConnection();
  const navigate = useNavigate();
  const now = useNow();
  const actions = useCompetitionActions();
  const [moveError, setMoveError] = useState<string | undefined>(undefined);
  const competition = useQuery({
    queryKey: competitionKey(competitionId),
    queryFn: () => getCompetition(connection, competitionId),
  });

  if (competition.isPending) return <Skeleton lines={8} label="Loading the competition" />;
  if (competition.isError) {
    return (
      <EmptyState
        icon={Trophy}
        title="This competition could not be loaded"
        description={
          isApiProblem(competition.error)
            ? (competition.error.detail ?? competition.error.title)
            : String(competition.error)
        }
        action={{
          label: 'Back to competitions',
          onAction: () => {
            void navigate({ to: '/competitions', search: DEFAULT_COMPETITIONS_SEARCH });
          },
        }}
      />
    );
  }
  const data = competition.data;
  const closed = data.allowed.length === 0;
  const editReason = data.can.edit
    ? undefined
    : closed
      ? `This competition is ${ENGAGEMENT_STATUS_LABELS[data.status].toLowerCase()} and can no longer be changed.`
      : 'Only this competition’s mentors or an administrator can change it.';

  return (
    <article aria-labelledby="competition-heading" className="flex flex-col gap-6">
      <Link
        to="/competitions"
        search={DEFAULT_COMPETITIONS_SEARCH}
        className="flex w-fit items-center gap-1 text-sm text-fg-muted hover:text-fg"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        All competitions
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 id="competition-heading" className="font-display text-xl">
            {whoOf(data)} — {data.event.title}
          </h1>
          <p className="flex flex-wrap items-center gap-3 text-sm text-fg-muted">
            <CompetitionStatus status={data.status} />
            <span>{KIND_LABELS[data.kind]}</span>
            <NextDeadline next={data.nextDeadline} now={now} />
          </p>
          <p className="flex flex-wrap gap-3 text-sm">
            <Link
              to="/discover/event/$eventId"
              params={{ eventId: data.event.id }}
              search={DEFAULT_SEARCH}
              className="text-accent hover:underline"
            >
              Open the event
            </Link>
            {data.team !== null && (
              <Link
                to="/teams/$teamId"
                params={{ teamId: data.team.id }}
                className="text-accent hover:underline"
              >
                Open {data.team.name}
              </Link>
            )}
            {data.student !== null && (
              <Link
                to="/students/$studentId"
                params={{ studentId: data.student.id }}
                className="text-accent hover:underline"
              >
                Open {data.student.fullName}
              </Link>
            )}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <MoveMenu
            name={whoOf(data)}
            status={data.status}
            disabled={!data.can.edit}
            onMove={(to) => {
              setMoveError(undefined);
              void actions.move(data, to).then((result) => {
                if (!result.ok && 'message' in result) setMoveError(result.message);
              });
            }}
          />
          {editReason !== undefined && (
            <p className="max-w-sm text-right text-xs text-fg-muted">{editReason}</p>
          )}
          {moveError !== undefined && (
            <p role="alert" className="flex items-center gap-1 text-sm text-danger">
              <CircleAlert aria-hidden="true" className="size-4" />
              {moveError}
            </p>
          )}
        </div>
      </header>

      <Guide id="competition-page" title="What this page is for">
        <p>
          One event, taken on by one team or one student. The <strong>roster</strong> and the{' '}
          <strong>mentors</strong> were copied when it was assigned, so changes to the team later do
          not move them — edit them here. A student can be on only one open competition per event.
        </p>
        <p>
          <strong>Move to…</strong> offers only the moves that are allowed from here. Completed,
          Withdrawn and Not selected are final.
        </p>
      </Guide>

      <History competition={data} />
      <RosterSection competition={data} reason={editReason} />
      <CompetitionMentors competition={data} />
      <Notes key={data.version} competition={data} />
      <ResourcesScope competitionId={data.id}>
        <WorkflowSection competitionId={data.id} status={data.status} />
        <CompetitionResources competitionId={data.id} />
      </ResourcesScope>
      <Later
        id="outcome-heading"
        title="Outcome"
        icon={Medal}
        text="No outcome recorded. Once the competition is completed, its result is recorded here."
      />
      {actions.dialog}
    </article>
  );
}
