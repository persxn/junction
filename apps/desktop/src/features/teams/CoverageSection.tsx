import { TEAM_TARGETS_MAX, type TeamDetail } from '@compintel/contracts';
import { useId, useState } from 'react';

import { updateTeam } from '../../api/teams.js';
import { useBackendConnection } from '../../shell/connection-context.js';
import { CoverageChips, CoverageLegend } from './labels.js';
import { coverageText, disabledReason, parseTargets } from './team-model.js';
import { useTeamActions } from './use-team-actions.js';

/**
 * Skill coverage (§16.2, R94): one chip per skill, its state in words, the
 * legend that says what each state means, and the editor for the skills the
 * team wants — the targets that can come out Missing.
 */
export function CoverageSection({ team }: { readonly team: TeamDetail }): React.JSX.Element {
  return (
    <section aria-labelledby="coverage-heading" className="flex flex-col gap-3">
      <h2 id="coverage-heading" className="text-md">
        Skill coverage
        <span className="ml-2 text-sm font-normal text-fg-muted">
          {coverageText(team.coverage.counts)}
        </span>
      </h2>
      <CoverageChips chips={team.coverage.chips} />
      <details className="text-sm">
        <summary className="cursor-pointer text-fg-muted">
          What Covered, Thin and Missing mean
        </summary>
        <div className="mt-2">
          <CoverageLegend />
        </div>
      </details>
      {/* Keyed by the saved list, so a save or a reload refills the field. */}
      <TargetForm key={team.targets.join(',')} team={team} />
    </section>
  );
}

function TargetForm({ team }: { readonly team: TeamDetail }): React.JSX.Element {
  const connection = useBackendConnection();
  const actions = useTeamActions();
  const fieldId = useId();
  const hintId = useId();
  const [text, setText] = useState(team.targets.join(', '));
  const reason = disabledReason(team, 'edit');
  const next = parseTargets(text);
  const tooMany = next.length > TEAM_TARGETS_MAX;
  const changed = next.join('|') !== team.targets.join('|');
  return (
    <form
      className="flex max-w-xl flex-col gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        if (!changed || tooMany) return;
        void actions.run({
          team,
          failure: 'The skills this team needs were not saved',
          call: (version) => updateTeam(connection, team.id, { targets: next, version }),
        });
      }}
    >
      <label htmlFor={fieldId} className="text-sm font-medium">
        Skills this team needs
      </label>
      <div className="flex gap-2">
        <input
          id={fieldId}
          type="text"
          value={text}
          disabled={reason !== undefined}
          aria-describedby={hintId}
          aria-invalid={tooMany}
          placeholder="e.g. Python, Machine learning, UI design"
          onChange={(event) => {
            setText(event.target.value);
          }}
          className="flex-1 rounded-md border border-line bg-surface px-2 py-1.5 disabled:cursor-not-allowed"
        />
        <button
          type="submit"
          disabled={reason !== undefined || !changed || tooMany}
          className="rounded-md border border-line px-3 py-1.5 hover:bg-surface-hover disabled:opacity-50"
        >
          Save skills
        </button>
      </div>
      <p id={hintId} className="text-xs text-fg-muted">
        {reason ??
          (tooMany
            ? `At most ${String(TEAM_TARGETS_MAX)} skills.`
            : 'Separate skills with commas. A skill no active member has shows as Missing.')}
      </p>
    </form>
  );
}
