import { LogOut, UserRound } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useTheme } from '../theme/theme-context.js';
import { THEME_CHOICES, type ThemeChoice } from '../theme/theme.js';

const THEME_LABELS: Record<ThemeChoice, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'Follow Windows',
};

export interface UserMenuProps {
  readonly onExit: () => void;
}

/**
 * The user menu from §16.1. It carries what exists today: the theme choice and
 * "Exit completely". Lock and sign out need a session, so they arrive with
 * WP-07a — there is no signed-in user to name yet, which is why the trigger says
 * "Preferences" rather than pretending to be an account.
 */
export function UserMenu({ onExit }: UserMenuProps): React.JSX.Element {
  const { choice, setChoice } = useTheme();
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    const onPointerDown = (event: PointerEvent): void => {
      if (!container.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
        }}
        className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-fg-muted hover:bg-surface-hover"
      >
        <UserRound aria-hidden="true" className="size-4" />
        Preferences
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Preferences"
          className="absolute right-0 z-30 mt-1 w-56 rounded-md border border-line bg-surface-raised p-1 shadow-[var(--ci-shadow-popover)]"
        >
          <p className="px-2 py-1 text-xs text-fg-subtle" id="user-menu-theme">
            Theme
          </p>
          {THEME_CHOICES.map((value) => (
            <button
              key={value}
              type="button"
              role="menuitemradio"
              aria-checked={choice === value}
              onClick={() => {
                setChoice(value);
              }}
              className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left hover:bg-surface-hover"
            >
              {THEME_LABELS[value]}
              {choice === value && <span aria-hidden="true">✓</span>}
            </button>
          ))}

          <hr className="my-1 border-line" />

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onExit();
            }}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-danger hover:bg-surface-hover"
          >
            <LogOut aria-hidden="true" className="size-4" />
            Exit completely
          </button>
        </div>
      )}
    </div>
  );
}
