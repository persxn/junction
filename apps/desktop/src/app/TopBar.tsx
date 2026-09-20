import { Link } from '@tanstack/react-router';
import { Bell, RefreshCw, Search } from 'lucide-react';

import { UserMenu } from './UserMenu.js';

export interface TopBarProps {
  /** The `/` shortcut focuses this; Ctrl+K and Enter on it open the palette. */
  readonly searchRef: React.RefObject<HTMLButtonElement | null>;
  readonly onOpenPalette: () => void;
  readonly onExit: () => void;
}

/**
 * The top bar (§16.1): search box, freshness pill, notifications bell, user menu.
 *
 * The search box is a button, not a text field. Until WP-15a there is nothing to
 * type into — a field that swallows text and does nothing is worse than a control
 * that plainly opens what does work. It carries the shortcut in its name, so
 * `aria-keyshortcuts` and the visible hint say the same thing.
 *
 * The freshness pill is a placeholder and says so: the per-source status popover
 * needs scrape runs, which arrive with WP-09a (ruling R29 keeps the same line out
 * of the tray until WP-30).
 */
export function TopBar({ searchRef, onOpenPalette, onExit }: TopBarProps): React.JSX.Element {
  return (
    <header
      aria-label="Top bar"
      className="ci-chrome flex shrink-0 items-center gap-3 border-b border-line px-3"
      style={{ height: 'var(--ci-topbar-height)' }}
    >
      <button
        ref={searchRef}
        type="button"
        onClick={onOpenPalette}
        aria-keyshortcuts="Control+K"
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-line bg-surface px-3 py-1.5 text-left text-fg-subtle hover:bg-surface-hover"
      >
        <Search aria-hidden="true" className="size-4 shrink-0" />
        <span className="truncate">Search or ask</span>
        <kbd className="ml-auto rounded-sm border border-line px-1 text-xs">Ctrl+K</kbd>
      </button>

      <p className="flex items-center gap-1.5 rounded-full bg-surface-sunken px-2.5 py-1 text-sm text-fg-muted">
        <RefreshCw aria-hidden="true" className="size-3.5" />
        Freshness: not tracked yet
      </p>

      <Link
        to="/notifications"
        aria-label="Notifications"
        className="rounded-md p-2 text-fg-muted hover:bg-surface-hover data-[status=active]:text-accent"
      >
        <Bell aria-hidden="true" className="size-4" />
      </Link>

      <UserMenu onExit={onExit} />
    </header>
  );
}
