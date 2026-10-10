import { KPI_SCOPES, type KpiScope } from '@compintel/contracts';
import { useId, useState } from 'react';

import { Guide } from '../../components/Guide.js';
import { AssignProvider } from '../competitions/assign/assign-context.js';
import { EventPanel } from './EventPanel.js';
import { KpiStrip } from './KpiStrip.js';
import { ActivePanel, NotificationsPanel, RadarPanel } from './Panels.js';
import { useInstallation } from '../../app/installation.js';

/**
 * The Dashboard (§16.2, R107, WP-22): the KPI strip, the Radar's next eight,
 * Nearby and Recommended events, active competitions with progress and health,
 * and recent notifications (WP-23 fills it). One scope toggle — Mine · All,
 * Mine by default — applies to the competitions tile, the overdue tile, the
 * Radar and Active teams; the event tiles are the same for everyone.
 */

const SCOPE_LABELS: Readonly<Record<KpiScope, string>> = { MINE: 'Mine', ALL: 'Everyone’s' };

export function DashboardPage(): React.JSX.Element {
  const { isStudent } = useInstallation();
  const [scope, setScope] = useState<KpiScope>('MINE');
  const id = useId();
  return (
    <AssignProvider>
      <section aria-labelledby={`${id}-heading`} className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 id={`${id}-heading`} className="ci-heading-sweep font-display text-xl">
            Dashboard
          </h1>
          <div role="group" aria-label="Whose work" className="flex rounded-md border border-line">
            {KPI_SCOPES.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={scope === value}
                onClick={() => {
                  setScope(value);
                }}
                className="px-3 py-1.5 text-sm aria-pressed:bg-accent-surface aria-pressed:font-medium"
              >
                {SCOPE_LABELS[value]}
              </button>
            ))}
          </div>
        </div>
        <Guide id="dashboard" title="What the Dashboard shows">
          <p>
            Each number opens the list it counts, already filtered — the list shows the same total.
            <strong> Mine</strong> means competitions you {isStudent ? 'own' : 'mentor'} and events
            you saved;
            <strong> Everyone’s</strong> covers{' '}
            {isStudent ? 'everyone on this computer' : 'the whole department'}. Event numbers are
            the same for everyone.
          </p>
        </Guide>
        <KpiStrip scope={scope} />
        <div className="grid gap-4 lg:grid-cols-2">
          <RadarPanel scope={scope} />
          <ActivePanel scope={scope} />
          <EventPanel view="nearby" title="Nearby" />
          <EventPanel view="recommended" title="Recommended" />
          <NotificationsPanel />
        </div>
      </section>
    </AssignProvider>
  );
}
