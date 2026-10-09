import { INTEREST_TAG_NAME_MAX, type InterestOption } from '@compintel/contracts';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';

import { interestTagOptions, interestTagOptionsKey } from '../../api/saved-searches.js';
import { useBackendConnection } from '../../shell/connection-context.js';

export interface TagComboboxProps {
  /** Tags already chosen; they are not offered again. */
  readonly chosen: readonly InterestOption[];
  readonly onPick: (tag: InterestOption) => void;
  /** "Add “…” as an interest": a new INTEREST tag (R113). */
  readonly onCreate: (name: string) => void;
}

type Choice = { kind: 'tag'; tag: InterestOption } | { kind: 'new'; name: string };

const fold = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * A combobox over existing tags — technologies, themes and skills — with
 * "Add “…” as an interest" for a word nobody has used yet (WP-24 step 7).
 * ARIA 1.2's pattern: the input owns a listbox; ↓/↑ move the active option,
 * Enter picks it, Esc closes the list (a second Esc closes the dialog).
 */
export function TagCombobox({ chosen, onPick, onCreate }: TagComboboxProps): React.JSX.Element {
  const connection = useBackendConnection();
  const id = useId();
  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(text.trim());
    }, 200);
    return () => {
      clearTimeout(timer);
    };
  }, [text]);
  const options = useQuery({
    queryKey: interestTagOptionsKey(debounced),
    queryFn: () => interestTagOptions(connection, debounced),
    enabled: open,
  });

  const taken = new Set(chosen.map((tag) => fold(tag.name)));
  const tags = (options.data?.tags ?? []).filter((tag) => !taken.has(fold(tag.name)));
  const typed = text.trim();
  const exact =
    typed !== '' && (taken.has(fold(typed)) || tags.some((tag) => fold(tag.name) === fold(typed)));
  const choices: Choice[] = [
    ...tags.map((tag): Choice => ({ kind: 'tag', tag })),
    ...(typed === '' || exact ? [] : [{ kind: 'new', name: typed } as const]),
  ];
  const current = Math.min(active, Math.max(choices.length - 1, 0));
  const listId = `${id}-list`;
  const optionId = (index: number): string => `${id}-option-${String(index)}`;

  const choose = (choice: Choice): void => {
    if (choice.kind === 'tag') onPick(choice.tag);
    else onCreate(choice.name);
    setText('');
    setActive(0);
  };

  return (
    <div className="relative">
      <label htmlFor={`${id}-input`} className="flex flex-col gap-0.5 text-sm">
        Add a technology, theme or skill
        <input
          id={`${id}-input`}
          role="combobox"
          aria-expanded={open && choices.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && choices.length > 0 ? optionId(current) : undefined}
          value={text}
          maxLength={INTEREST_TAG_NAME_MAX}
          placeholder="Rust, Open Source, Design…"
          onChange={(event) => {
            setText(event.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => {
            setOpen(true);
          }}
          onBlur={() => {
            setOpen(false);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setOpen(true);
              setActive(Math.min(current + 1, choices.length - 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive(Math.max(current - 1, 0));
            } else if (event.key === 'Enter') {
              const choice = choices[current];
              if (open && choice !== undefined) {
                event.preventDefault();
                choose(choice);
              }
            } else if (event.key === 'Escape' && open && choices.length > 0) {
              // Closes the list only; the dialog's Esc is the next one.
              event.stopPropagation();
              setOpen(false);
            }
          }}
          className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm"
        />
      </label>
      {open && choices.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Matching tags"
          className="absolute left-0 right-0 z-40 mt-1 max-h-48 overflow-auto rounded-md border border-line bg-surface-raised p-1 shadow-[var(--ci-shadow-popover)]"
        >
          {choices.map((choice, index) => (
            <li
              key={choice.kind === 'tag' ? choice.tag.id : `new:${choice.name}`}
              id={optionId(index)}
              role="option"
              aria-selected={index === current}
              onMouseDown={(event) => {
                // Before the input's blur closes the list.
                event.preventDefault();
                choose(choice);
              }}
              className={`cursor-pointer rounded-sm px-2 py-1 text-sm ${index === current ? 'bg-accent-surface text-accent' : ''}`}
            >
              {choice.kind === 'tag' ? choice.tag.name : `Add “${choice.name}” as an interest`}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
