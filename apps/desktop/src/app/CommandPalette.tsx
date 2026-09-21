import { Command, defaultFilter } from 'cmdk';
import { CalendarSearch, Search } from 'lucide-react';
import { useState } from 'react';

import { EVENT_TYPE_LABELS } from '../features/discover/labels.js';
import { usePaletteEvents } from '../features/discover/use-palette-events.js';
import { groupCommands, type AppCommand } from './commands.js';

export interface CommandPaletteProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly commands: readonly AppCommand[];
  /** WP-16a: an event picked from the live results. */
  readonly onOpenEvent: (eventId: string) => void;
  /** WP-16a: "See all results in Discover" for the typed text. */
  readonly onSeeAll: (text: string) => void;
}

/** Event rows are already a server search; cmdk must not filter them again. */
const EVENT_VALUE = 'event:';
const paletteFilter = (value: string, search: string, keywords?: string[]): number =>
  value.startsWith(EVENT_VALUE) ? 1 : defaultFilter(value, search, keywords);

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
  onOpenEvent,
  onSeeAll,
}: CommandPaletteProps): React.JSX.Element {
  const groups = groupCommands(commands);
  const [input, setInput] = useState('');
  const events = usePaletteEvents(open ? input : '');
  const text = input.trim();
  const run = (action: () => void): void => {
    // Close first: several commands take the window away, and a palette left
    // open over a hidden window comes back open.
    onOpenChange(false);
    setInput('');
    action();
  };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Command palette"
      filter={paletteFilter}
      overlayClassName="fixed inset-0 z-40 bg-black/40"
      contentClassName="fixed top-[18vh] left-1/2 z-50 w-[min(560px,90vw)] -translate-x-1/2 overflow-hidden rounded-lg border border-line bg-surface-raised text-fg shadow-[var(--ci-shadow-popover)]"
    >
      <Command.Input
        value={input}
        onValueChange={setInput}
        placeholder="Search events or type a command…"
        className="w-full border-b border-line bg-transparent px-4 py-3 text-md outline-none placeholder:text-fg-subtle"
      />
      <Command.List className="max-h-[50vh] overflow-y-auto p-2">
        <Command.Empty className="px-2 py-6 text-center text-fg-muted">
          No matching command.
        </Command.Empty>
        {text.length > 0 && (
          <Command.Group
            heading={events.isLoading ? 'Events — searching…' : 'Events'}
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-fg-subtle"
          >
            {events.items.map((item) => (
              <Command.Item
                key={item.id}
                value={`${EVENT_VALUE}${item.id}`}
                onSelect={() => {
                  run(() => {
                    onOpenEvent(item.id);
                  });
                }}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 data-[selected=true]:bg-accent-surface data-[selected=true]:text-accent"
              >
                <CalendarSearch aria-hidden="true" className="size-4 shrink-0" />
                <span className="truncate">{item.title}</span>
                <span className="ml-auto shrink-0 text-xs text-fg-subtle">
                  {EVENT_TYPE_LABELS[item.eventType]}
                </span>
              </Command.Item>
            ))}
            <Command.Item
              value={`${EVENT_VALUE}see-all`}
              onSelect={() => {
                run(() => {
                  onSeeAll(text);
                });
              }}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 data-[selected=true]:bg-accent-surface data-[selected=true]:text-accent"
            >
              <Search aria-hidden="true" className="size-4 shrink-0" />
              See all results in Discover
            </Command.Item>
          </Command.Group>
        )}
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
                  run(command.run);
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
