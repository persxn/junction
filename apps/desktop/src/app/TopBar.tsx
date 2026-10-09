import { Search } from 'lucide-react';

import { FreshnessPill } from '../features/freshness/FreshnessPill.js';
import { NotificationBell } from '../features/notifications/NotificationBell.js';
import { UserMenu } from './UserMenu.js';

export interface TopBarProps {
  /** The `/` shortcut focuses this field. */
  readonly searchRef: React.RefObject<HTMLInputElement | null>;
  readonly onOpenPalette: () => void;
  /** Enter in the field: search Discover for this text ('' clears it). */
  readonly onSearch: (text: string) => void;
  readonly onExit: () => void;
}

/**
 * The top bar (§16.1): search box, freshness pill, notifications bell, user menu.
 *
 * The search box is a real field since WP-16a (WP-06 left it a button until
 * there was search to type into): `/` focuses it, Enter searches Discover, and
 * the Ctrl+K button beside it opens the palette, which searches events live.
 *
 * The freshness pill is real since WP-16b: "Updated 4 min ago", and a popover
 * with each source's state. Ruling R29 keeps the same line out of the tray
 * until WP-30, so this is the in-app surface and the only one.
 */
export function TopBar({
  searchRef,
  onOpenPalette,
  onSearch,
  onExit,
}: TopBarProps): React.JSX.Element {
  return (
    <header
      aria-label="Top bar"
      className="ci-chrome flex shrink-0 items-center gap-3 border-b border-line px-3"
      style={{ height: 'var(--ci-topbar-height)' }}
    >
      <form
        role="search"
        aria-label="Search events"
        onSubmit={(event) => {
          event.preventDefault();
          onSearch(searchRef.current?.value.trim() ?? '');
        }}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-line bg-surface px-3 py-1 text-fg-subtle focus-within:border-accent"
      >
        <Search aria-hidden="true" className="size-4 shrink-0" />
        <input
          ref={searchRef}
          type="search"
          name="q"
          aria-label="Search events"
          aria-keyshortcuts="/"
          placeholder="Search events"
          onKeyDown={(event) => {
            if (event.key === 'Escape') event.currentTarget.blur();
          }}
          className="min-w-0 flex-1 bg-transparent py-0.5 text-fg outline-none placeholder:text-fg-subtle"
        />
        <button
          type="button"
          onClick={onOpenPalette}
          aria-label="Open command palette"
          aria-keyshortcuts="Control+K"
          className="rounded-sm border border-line px-1 text-xs hover:bg-surface-hover"
        >
          Ctrl+K
        </button>
      </form>

      <FreshnessPill />

      <NotificationBell />

      <UserMenu onExit={onExit} />
    </header>
  );
}
