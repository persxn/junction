import { Outlet, useNavigate } from '@tanstack/react-router';
import { useCallback, useMemo, useRef, useState } from 'react';

import { ErrorBoundary } from '../components/ErrorBoundary.js';
import { discoverSearch } from '../features/discover/search-state.js';
import { useNotificationDelivery } from '../features/notifications/use-notification-delivery.js';
import { useGlobalHotkeys, type Hotkey } from '../lib/hotkeys.js';
import { exitCompletely, hideToTray, openLogsFolder } from '../shell/backend.js';
import { useTheme } from '../theme/theme-context.js';
import { CommandPalette } from './CommandPalette.js';
import { buildCommands } from './commands.js';
import { NavRail } from './NavRail.js';
import { TopBar } from './TopBar.js';
import { useRail } from './use-rail.js';

/**
 * The frame every screen sits in (§16.1): rail on the left, top bar above, the
 * route below. It also owns the two global shortcuts, because they have to work
 * on every screen and nowhere else is above every screen.
 *
 * Each route is wrapped in its own `ErrorBoundary`, so a screen that throws takes
 * down the screen and not the navigation the user needs to get away from it.
 */
export function AppShell(): React.JSX.Element {
  const { collapsed, toggle } = useRail();
  const { setChoice } = useTheme();
  const navigate = useNavigate();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // WP-16a: text from the top bar or the palette lands in Discover's own search
  // state, so the screen shows it as the query it is, with its chips kept.
  const searchDiscover = useCallback(
    (text: string): void => {
      void navigate({ to: '/discover', search: (previous) => discoverSearch(previous, text) });
    },
    [navigate],
  );

  const commands = useMemo(
    () =>
      buildCommands({
        navigate: (path) => {
          void navigate({ to: path });
        },
        setTheme: setChoice,
        openLogs: () => {
          void openLogsFolder();
        },
        hideToTray: () => {
          void hideToTray();
        },
        exitCompletely: () => {
          void exitCompletely();
        },
      }),
    [navigate, setChoice],
  );

  const hotkeys = useMemo<readonly Hotkey[]>(
    () => [
      {
        key: 'k',
        ctrl: true,
        allowWhileTyping: true,
        onPress: () => {
          setPaletteOpen(true);
        },
      },
      {
        key: '/',
        onPress: () => {
          searchRef.current?.focus();
        },
      },
    ],
    [],
  );
  useGlobalHotkeys(hotkeys);
  // WP-23: the tray badge, CRITICAL toasts and toast clicks.
  useNotificationDelivery();

  return (
    <div className="flex h-full bg-surface text-fg">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded-md focus:bg-accent focus:px-3 focus:py-1.5 focus:text-on-accent"
      >
        Skip to content
      </a>

      <NavRail collapsed={collapsed} onToggle={toggle} />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          searchRef={searchRef}
          onOpenPalette={() => {
            setPaletteOpen(true);
          }}
          onSearch={searchDiscover}
          onExit={() => {
            void exitCompletely();
          }}
        />
        <main id="main" className="min-h-0 flex-1 overflow-auto p-6">
          <ErrorBoundary label="this screen">
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        commands={commands}
        onOpenEvent={(eventId) => {
          void navigate({
            to: '/discover/event/$eventId',
            params: { eventId },
            search: (previous) => discoverSearch(previous, undefined),
          });
        }}
        onSeeAll={searchDiscover}
      />
    </div>
  );
}
