import { Link } from '@tanstack/react-router';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';

import { MAIN_NAV } from './nav.js';

export interface NavRailProps {
  readonly collapsed: boolean;
  readonly onToggle: () => void;
}

/**
 * The left rail (§16.1). Collapsed, it keeps the icons and moves the labels into
 * the accessible name, so the rail is narrower but no less usable to a screen
 * reader or to someone hovering for a tooltip.
 *
 * No admin section: see the seam in `nav.ts`.
 */
export function NavRail({ collapsed, onToggle }: NavRailProps): React.JSX.Element {
  return (
    <div
      className="ci-chrome flex shrink-0 flex-col border-r border-line transition-[width] duration-[var(--ci-motion-base)] ease-(--ease-out-ui)"
      style={{
        width: collapsed ? 'var(--ci-rail-width-collapsed)' : 'var(--ci-rail-width)',
      }}
    >
      <div className="flex items-center gap-2 px-2" style={{ height: 'var(--ci-topbar-height)' }}>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand the navigation' : 'Collapse the navigation'}
          className="rounded-md p-2 text-fg-muted hover:bg-surface-hover"
        >
          {collapsed ? (
            <PanelLeftOpen aria-hidden="true" className="size-4" />
          ) : (
            <PanelLeftClose aria-hidden="true" className="size-4" />
          )}
        </button>
        {!collapsed && <span className="font-display font-semibold">CompIntel</span>}
      </div>

      <nav aria-label="Main" className="flex flex-col gap-0.5 p-2">
        {MAIN_NAV.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.id}
              to={item.path}
              activeOptions={{ exact: item.path === '/' }}
              aria-label={collapsed ? item.label : undefined}
              title={collapsed ? item.label : undefined}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-fg-muted hover:bg-surface-hover data-[status=active]:bg-accent-surface data-[status=active]:font-medium data-[status=active]:text-accent"
            >
              <Icon aria-hidden="true" className="size-4 shrink-0" />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
