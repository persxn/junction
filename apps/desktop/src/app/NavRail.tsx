import { Link } from '@tanstack/react-router';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';

import { useAuth } from '../auth/auth-context.js';
import { ADMIN_NAV, MAIN_NAV, type NavItem } from './nav.js';

const ITEM_CLASS =
  'flex items-center gap-2 rounded-md px-2 py-1.5 text-fg-muted hover:bg-surface-hover ' +
  'data-[status=active]:bg-accent-surface data-[status=active]:font-medium data-[status=active]:text-accent';

export interface NavRailProps {
  readonly collapsed: boolean;
  readonly onToggle: () => void;
}

/**
 * The left rail (§16.1). Collapsed, it keeps the icons and moves the labels into
 * the accessible name, so the rail is narrower but no less usable to a screen
 * reader or to someone hovering for a tooltip.
 *
 * The admin section appears only for an account whose `/me` permissions include
 * that item's capability (ruling R32). §10.1 is explicit that this is cosmetic:
 * the route guard and, above all, the server decide.
 */
export function NavRail({ collapsed, onToggle }: NavRailProps): React.JSX.Element {
  const { can } = useAuth();
  const adminItems = ADMIN_NAV.filter((item) => can(item.action));

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
        {MAIN_NAV.map((item) => (
          <RailLink key={item.id} item={item} collapsed={collapsed} />
        ))}
      </nav>

      {adminItems.length > 0 && (
        <nav aria-label="Administration" className="flex flex-col gap-0.5 border-t border-line p-2">
          {!collapsed && (
            <p className="px-2 pb-1 text-xs tracking-wide text-fg-subtle uppercase">Admin</p>
          )}
          {adminItems.map((item) => (
            <RailLink key={item.id} item={item} collapsed={collapsed} />
          ))}
        </nav>
      )}
    </div>
  );
}

function RailLink({
  item,
  collapsed,
}: {
  readonly item: NavItem;
  readonly collapsed: boolean;
}): React.JSX.Element {
  const Icon = item.icon;
  return (
    <Link
      to={item.path}
      activeOptions={{ exact: item.path === '/' }}
      aria-label={collapsed ? item.label : undefined}
      title={collapsed ? item.label : undefined}
      className={ITEM_CLASS}
    >
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </Link>
  );
}
