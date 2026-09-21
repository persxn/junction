import { useRef } from 'react';

export interface TabItem<T extends string> {
  readonly id: T;
  readonly label: string;
}

export interface TabsProps<T extends string> {
  readonly label: string;
  readonly items: readonly TabItem<T>[];
  readonly selected: T;
  readonly onSelect: (id: T) => void;
  /** The id of the panel the tabs control. */
  readonly panelId: string;
  readonly size?: 'md' | 'sm';
}

/**
 * A WAI-ARIA tablist: one tab in the tab order, arrow keys (and Home/End) move
 * between tabs and select as they go. Selection is the router's state, so it
 * survives the drawer opening over the list.
 */
export function Tabs<T extends string>({
  label,
  items,
  selected,
  onSelect,
  panelId,
  size = 'md',
}: TabsProps<T>): React.JSX.Element {
  const refs = useRef(new Map<T, HTMLButtonElement>());

  const move = (from: T, delta: number | 'first' | 'last'): void => {
    const index = items.findIndex((item) => item.id === from);
    const next =
      delta === 'first'
        ? items[0]
        : delta === 'last'
          ? items[items.length - 1]
          : items[(index + delta + items.length) % items.length];
    if (next === undefined) return;
    onSelect(next.id);
    refs.current.get(next.id)?.focus();
  };

  return (
    <div role="tablist" aria-label={label} className="flex gap-1 border-b border-line">
      {items.map((item) => {
        const active = item.id === selected;
        return (
          <button
            key={item.id}
            ref={(element) => {
              if (element === null) refs.current.delete(item.id);
              else refs.current.set(item.id, element);
            }}
            type="button"
            role="tab"
            id={`${panelId}-tab-${item.id}`}
            aria-selected={active}
            aria-controls={panelId}
            tabIndex={active ? 0 : -1}
            onClick={() => {
              onSelect(item.id);
            }}
            onKeyDown={(event) => {
              const keys: Record<string, number | 'first' | 'last'> = {
                ArrowRight: 1,
                ArrowLeft: -1,
                Home: 'first',
                End: 'last',
              };
              const delta = keys[event.key];
              if (delta === undefined) return;
              event.preventDefault();
              move(item.id, delta);
            }}
            className={`-mb-px border-b-2 px-3 ${size === 'sm' ? 'py-1 text-sm' : 'py-2'} ${
              active
                ? 'border-accent font-medium text-fg'
                : 'border-transparent text-fg-muted hover:text-fg'
            }`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
