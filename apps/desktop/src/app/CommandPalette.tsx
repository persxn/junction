import { Command } from 'cmdk';

import { groupCommands, type AppCommand } from './commands.js';

export interface CommandPaletteProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly commands: readonly AppCommand[];
}

/**
 * The Ctrl+K palette (§16.3).
 *
 * It renders a list and nothing more: what each entry does is decided in
 * `commands.ts`. cmdk supplies the filtering, the arrow-key cursor and the
 * `aria-selected` bookkeeping; the surrounding dialog supplies Esc and the focus
 * trap, so the whole thing is reachable with the keyboard alone.
 */
export function CommandPalette({
  open,
  onOpenChange,
  commands,
}: CommandPaletteProps): React.JSX.Element {
  const groups = groupCommands(commands);

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Command palette"
      overlayClassName="fixed inset-0 z-40 bg-black/40"
      contentClassName="fixed top-[18vh] left-1/2 z-50 w-[min(560px,90vw)] -translate-x-1/2 overflow-hidden rounded-lg border border-line bg-surface-raised text-fg shadow-[var(--ci-shadow-popover)]"
    >
      <Command.Input
        placeholder="Type a command…"
        className="w-full border-b border-line bg-transparent px-4 py-3 text-md outline-none placeholder:text-fg-subtle"
      />
      <Command.List className="max-h-[50vh] overflow-y-auto p-2">
        <Command.Empty className="px-2 py-6 text-center text-fg-muted">
          No matching command.
        </Command.Empty>
        {groups.map(([heading, items]) => (
          <Command.Group
            key={heading}
            heading={heading}
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-fg-subtle"
          >
            {items.map((command) => (
              <Command.Item
                key={command.id}
                value={`${command.label} ${command.keywords}`}
                onSelect={() => {
                  // Close first: several commands take the window away, and a
                  // palette left open over a hidden window comes back open.
                  onOpenChange(false);
                  command.run();
                }}
                className="cursor-pointer rounded-md px-2 py-1.5 data-[selected=true]:bg-accent-surface data-[selected=true]:text-accent"
              >
                {command.label}
              </Command.Item>
            ))}
          </Command.Group>
        ))}
      </Command.List>
    </Command.Dialog>
  );
}
