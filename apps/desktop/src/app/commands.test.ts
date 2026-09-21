import { describe, expect, it } from 'vitest';

import { buildCommands, groupCommands, type CommandActions } from './commands.js';
import { CREATE_EVENT_PATH, MAIN_NAV } from './nav.js';

/** Records what each command did, in the order it did it. */
function actions(): CommandActions & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    navigate: (path) => {
      calls.push(`navigate:${path}`);
    },
    setTheme: (choice) => {
      calls.push(`theme:${choice}`);
    },
    openLogs: () => {
      calls.push('openLogs');
    },
    hideToTray: () => {
      calls.push('hideToTray');
    },
    exitCompletely: () => {
      calls.push('exitCompletely');
    },
  };
}

describe('the palette command list', () => {
  it('offers one "go to" command per rail item, plus WP-14 two actions', () => {
    const commands = buildCommands(actions());
    const goTo = commands.filter((command) => command.group === 'Go to');
    expect(goTo.map((command) => command.label)).toStrictEqual([
      ...MAIN_NAV.map((item) => item.label),
      // Adding an event has no rail item — it is something you do, not a place
      // you go — so the palette is where it lives until Discover exists.
      'Add an event',
      'Import an event from a link',
    ]);
  });

  it('lists only what works today — no search, no admin', () => {
    const labels = buildCommands(actions()).map((command) => command.label);
    expect(labels).toStrictEqual([
      ...MAIN_NAV.map((item) => item.label),
      'Add an event',
      'Import an event from a link',
      'Theme: light',
      'Theme: dark',
      'Theme: follow Windows',
      'Open logs folder',
      'Hide to tray',
      'Exit completely',
    ]);
  });

  it('gives every command a unique id', () => {
    const ids = buildCommands(actions()).map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("dispatches each command's action exactly once", () => {
    const deps = actions();
    for (const command of buildCommands(deps)) {
      command.run();
    }
    expect(deps.calls).toStrictEqual([
      ...MAIN_NAV.map((item) => `navigate:${item.path}`),
      `navigate:${CREATE_EVENT_PATH}`,
      `navigate:${CREATE_EVENT_PATH}`,
      'theme:light',
      'theme:dark',
      'theme:system',
      'openLogs',
      'hideToTray',
      'exitCompletely',
    ]);
  });

  it('groups them in a stable order', () => {
    const groups = groupCommands(buildCommands(actions()));
    expect(groups.map(([heading]) => heading)).toStrictEqual(['Go to', 'Appearance', 'Window']);
  });

  it('drops a group that has nothing in it', () => {
    const commands = buildCommands(actions()).filter((command) => command.group === 'Window');
    expect(groupCommands(commands).map(([heading]) => heading)).toStrictEqual(['Window']);
  });
});
