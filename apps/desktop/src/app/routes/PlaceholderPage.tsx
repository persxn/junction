import { useNavigate } from '@tanstack/react-router';

import { EmptyState } from '../../components/EmptyState.js';
import type { NavItem } from '../nav.js';

/**
 * One screen per rail item until its own work package builds it.
 *
 * It is not a stub with "TODO" on it: it names the screen, says what will live
 * there, and — per §16.3 — offers the next action that *does* work today, which
 * is the command palette.
 */
export function PlaceholderPage({ item }: { readonly item: NavItem }): React.JSX.Element {
  const navigate = useNavigate();
  return (
    <section aria-labelledby={`${item.id}-heading`} className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 id={`${item.id}-heading`} className="text-xl">
          {item.label}
        </h1>
        <p className="text-fg-muted">{item.summary}</p>
      </div>
      <EmptyState
        icon={item.icon}
        title={`${item.label} is not built yet`}
        description="It arrives with its own work package (roadmap §19). The navigation, theme and command palette around it are real and working."
        action={{
          label: 'Back to the dashboard',
          onAction: () => {
            void navigate({ to: '/' });
          },
        }}
      />
    </section>
  );
}
