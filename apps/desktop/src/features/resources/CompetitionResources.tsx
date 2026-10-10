import { useId } from 'react';

import { Guide } from '../../components/Guide.js';
import { Skeleton } from '../../components/Skeleton.js';
import { problemText } from '../competitions/use-competition-actions.js';
import { ResourceRows } from './ResourceRows.js';
import { useResources } from './ResourcesScope.js';

/**
 * The Competition page's Resources section (WP-20b, §16.2): links and files
 * for the competition as a whole; each stage and task has its own in the
 * workflow above. Its guide says what is kept and what opens.
 */
export function CompetitionResources({
  competitionId,
}: {
  readonly competitionId: string;
}): React.JSX.Element {
  const headingId = useId();
  const scope = useResources();
  let body: React.JSX.Element;
  if (scope === undefined || (scope.list === undefined && scope.error === null)) {
    body = <Skeleton lines={2} label="Loading the resources" />;
  } else if (scope.list === undefined) {
    body = (
      <p
        role="alert"
        className="flex flex-wrap items-center gap-2 rounded-md bg-danger-surface p-3 text-sm"
      >
        The resources did not load: {problemText(scope.error)}
        <button
          type="button"
          onClick={scope.retry}
          className="rounded-md border border-line px-2 py-0.5 text-xs hover:bg-surface-hover"
        >
          Try again
        </button>
      </p>
    );
  } else {
    body = (
      <ResourceRows ownerKind="ENGAGEMENT" ownerId={competitionId} ownerName="this competition" />
    );
  }
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h2 id={headingId} className="text-md">
        Resources
      </h2>
      <Guide id="competition-resources" title="Links and files">
        <p>
          Add a <strong>web link</strong>, a <strong>GitHub repository</strong>, a{' '}
          <strong>cloud document</strong> or a <strong>file or folder on a PC</strong> — to the
          competition here, or to a stage or task above. Only the link or path is kept; nothing is
          copied, uploaded or read.
        </p>
        <p>
          Documents, images and archives open with their usual program. Programs and scripts never
          open from Junction — use <strong>Show in Explorer</strong>. A path added on another PC
          says so; for anything the team shares, a link works on every PC.
        </p>
      </Guide>
      {body}
    </section>
  );
}
