import type { ThemeChoice } from '../theme/theme.js';
import { CREATE_EVENT_PATH, MAIN_NAV, type AppPath } from './nav.js';

/**
 * Everything the Ctrl+K palette can do today (§16.3).
 *
 * The list is built here, away from React, so "does every command dispatch its
 * action exactly once" is a plain function test. WP-06 lists only what exists:
 * navigation, theme, and the three shell actions. Search and natural-language
 * parsing are WP-15a/25a, and adding a command that does not work yet would
 * teach the user that the palette lies.
 */

export type CommandGroup = 'Go to' | 'Appearance' | 'Window';

export interface AppCommand {
  readonly id: string;
  readonly label: string;
  readonly group: CommandGroup;
  /** Extra words the palette should match on, beyond the label. */
  readonly keywords: string;
  readonly run: () => void;
}

export interface CommandActions {
  readonly navigate: (path: AppPath) => void;
  readonly setTheme: (choice: ThemeChoice) => void;
  readonly openLogs: () => void;
  readonly hideToTray: () => void;
  readonly exitCompletely: () => void;
}

const THEME_LABELS: Record<ThemeChoice, string> = {
  light: 'Theme: light',
  dark: 'Theme: dark',
  system: 'Theme: follow Windows',
};

export function buildCommands(actions: CommandActions): readonly AppCommand[] {
  const navigation: AppCommand[] = MAIN_NAV.map((item) => ({
    id: `go-${item.id}`,
    label: item.label,
    group: 'Go to',
    keywords: item.summary,
    run: () => {
      actions.navigate(item.path);
    },
  }));

  // WP-14's two entry points. Both land on the same screen, because typing an
  // event in and reviewing one read off a page end in the same form.
  navigation.push(
    {
      id: 'add-event',
      label: 'Add an event',
      group: 'Go to',
      keywords: 'new manual create event by hand',
      run: () => {
        actions.navigate(CREATE_EVENT_PATH);
      },
    },
    {
      id: 'import-event',
      label: 'Import an event from a link',
      group: 'Go to',
      keywords: 'url paste link devpost devfolio unstop import',
      run: () => {
        actions.navigate(CREATE_EVENT_PATH);
      },
    },
  );

  const appearance: AppCommand[] = (['light', 'dark', 'system'] as const).map((choice) => ({
    id: `theme-${choice}`,
    label: THEME_LABELS[choice],
    group: 'Appearance',
    keywords: 'appearance colour color dark light contrast',
    run: () => {
      actions.setTheme(choice);
    },
  }));

  const window: AppCommand[] = [
    {
      id: 'open-logs',
      label: 'Open logs folder',
      group: 'Window',
      keywords: 'diagnostics troubleshoot files',
      run: actions.openLogs,
    },
    {
      id: 'hide-to-tray',
      label: 'Hide to tray',
      group: 'Window',
      keywords: 'minimise minimize close background notification area',
      run: actions.hideToTray,
    },
    {
      id: 'exit-completely',
      label: 'Exit completely',
      group: 'Window',
      keywords: 'quit stop shut down background service',
      run: actions.exitCompletely,
    },
  ];

  return [...navigation, ...appearance, ...window];
}

/** The commands in the order the palette shows them, grouped by heading. */
export function groupCommands(
  commands: readonly AppCommand[],
): readonly (readonly [CommandGroup, readonly AppCommand[]])[] {
  const order: readonly CommandGroup[] = ['Go to', 'Appearance', 'Window'];
  return order
    .map((group) => [group, commands.filter((command) => command.group === group)] as const)
    .filter(([, items]) => items.length > 0);
}
