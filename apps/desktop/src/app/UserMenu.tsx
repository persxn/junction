import {
  Info,
  Lock,
  LogOut,
  Palette,
  PowerOff,
  Sparkles,
  UserRound,
  UserRoundPlus,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useAuth } from '../auth/auth-context.js';
import { AboutDialog } from './AboutDialog.js';
import { AppearanceDialog } from '../features/appearance/AppearanceDialog.js';
import { InterestsDialog } from '../features/interests/InterestsDialog.js';
import { ProfileDialog } from '../features/profile/ProfileDialog.js';
import { useInstallation } from './installation.js';
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
 * The user menu from §16.1: theme, lock, sign out, and "Exit completely".
 *
 * Lock and Exit completely are deliberately different things and are worded as
 * such: locking leaves the backend scraping (§10.5), exiting stops it (§3.2).
 */
export function UserMenu({ onExit }: UserMenuProps): React.JSX.Element {
  const { choice, setChoice } = useTheme();
  const { me, lock, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [interests, setInterests] = useState(false);
  const [appearance, setAppearance] = useState(false);
  const [about, setAbout] = useState(false);
  // WP-34 (R132-R134): a guest has no password, so no Lock; it can make a profile
  // instead. On Myself, signing the guest out would only sign it straight back in.
  const { isGuest, isIndividual } = useInstallation();
  const [profile, setProfile] = useState(false);
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
        <span className="max-w-40 truncate">{me?.user.displayName ?? 'Account'}</span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Account"
          className="absolute right-0 z-30 mt-1 w-56 rounded-md border border-line bg-surface-raised p-1 shadow-[var(--ci-shadow-popover)]"
        >
          {me !== undefined && (
            <p className="truncate px-2 py-1 text-xs text-fg-subtle">{me.user.email}</p>
          )}
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

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setAppearance(true);
            }}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-surface-hover"
          >
            <Palette aria-hidden="true" className="size-4" />
            Appearance…
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setAbout(true);
            }}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-surface-hover"
          >
            <Info aria-hidden="true" className="size-4" />
            About Junction
          </button>

          <hr className="my-1 border-line" />

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setInterests(true);
            }}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-surface-hover"
          >
            <Sparkles aria-hidden="true" className="size-4" />
            My interests
          </button>

          {isGuest ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                setProfile(true);
              }}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-surface-hover"
            >
              <UserRoundPlus aria-hidden="true" className="size-4" />
              Create my profile…
            </button>
          ) : (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                lock();
              }}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-surface-hover"
            >
              <Lock aria-hidden="true" className="size-4" />
              Lock
            </button>
          )}

          {!(isGuest && isIndividual) && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                void signOut();
              }}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-surface-hover"
            >
              <LogOut aria-hidden="true" className="size-4" />
              Sign out
            </button>
          )}

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
            <PowerOff aria-hidden="true" className="size-4" />
            Exit completely
          </button>
        </div>
      )}
      {interests && (
        <InterestsDialog
          onClose={() => {
            setInterests(false);
          }}
        />
      )}
      {profile && (
        <ProfileDialog
          onClose={() => {
            setProfile(false);
          }}
        />
      )}
      {about && (
        <AboutDialog
          onClose={() => {
            setAbout(false);
          }}
        />
      )}
      {appearance && (
        <AppearanceDialog
          onClose={() => {
            setAppearance(false);
          }}
        />
      )}
    </div>
  );
}
