import { MENTOR_ROLE_LABELS } from '@compintel/contracts';
import { useQuery } from '@tanstack/react-query';

import { listTemplates } from '../../../api/workflows.js';
import { useBackendConnection } from '../../../shell/connection-context.js';
import { TEMPLATES_KEY } from '../../workflows/TemplatePicker.js';
import type { StepProps } from './assign-model.js';

/**
 * Step "Confirm" (R96, R98): the roster and the mentors that will be copied —
 * frozen from here on — who is left out because they are inactive, and the
 * workflow that "Assign" copies (WP-20a).
 */
export function ConfirmStep({ draft }: StepProps): React.JSX.Element {
  const connection = useBackendConnection();
  const templates = useQuery({
    queryKey: [...TEMPLATES_KEY, 'list'],
    queryFn: () => listTemplates(connection),
  });
  const templateId = draft.workflow.templateId;
  const templateName =
    templateId === null
      ? 'a blank workflow'
      : `the “${templates.data?.items.find((item) => item.id === templateId)?.name ?? 'chosen'}” workflow`;
  const dated = Object.keys(draft.workflow.dueOverrides).length;
  const preview = draft.preview;
  if (preview === undefined)
    return <p className="text-sm text-fg-muted">Review the dates first.</p>;
  const several = preview.competitions.length > 1;
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p>
        {several
          ? `This creates ${String(preview.competitions.length)} competitions for “${draft.eventTitle}”, one per student.`
          : `This creates one competition for “${draft.eventTitle}”.`}{' '}
        The roster and mentors below are copied now; later changes to the team do not change them.
      </p>
      {preview.competitions.map((planned, index) => (
        <section
          key={planned.teamName ?? planned.roster[0]?.studentId ?? String(index)}
          aria-label={planned.teamName ?? planned.roster[0]?.fullName ?? 'Competition'}
          className="rounded-md border border-line p-3"
        >
          <h3 className="font-medium">{planned.teamName ?? planned.roster[0]?.fullName}</h3>
          <p className="mt-1 text-fg-muted">
            Taking part:{' '}
            {planned.roster
              .map((entry) =>
                entry.roleLabel === null
                  ? entry.fullName
                  : `${entry.fullName} (${entry.roleLabel})`,
              )
              .join(', ')}
          </p>
          <p className="text-fg-muted">
            Mentors:{' '}
            {planned.mentors
              .map(
                (mentor) =>
                  `${mentor.displayName} — ${MENTOR_ROLE_LABELS[mentor.role].toLowerCase()}`,
              )
              .join(', ')}
          </p>
        </section>
      ))}
      {templateId !== undefined && (
        <p>
          <span className="font-medium">Assign</span> starts {templateName}
          {dated > 0
            ? `, with ${String(dated)} ${dated === 1 ? 'date' : 'dates'} you set`
            : ''}.{' '}
          <span className="text-fg-muted">
            “Just considering” copies no workflow yet; it is copied when the competition is
            assigned.
          </span>
        </p>
      )}
      {preview.leftOut.length > 0 && (
        <p className="text-fg-muted">
          Left out because they are inactive:{' '}
          {preview.leftOut.map((entry) => entry.fullName).join(', ')}.
        </p>
      )}
    </div>
  );
}
