import { TEAM_ROLE_LABEL_MAX, type TeamMember } from '@compintel/contracts';
import { Crown, EllipsisVertical, Pencil, UserMinus } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { Dialog } from '../../components/Dialog.js';

/**
 * One member's menu (WP-18 step 6): edit role, make or stop being lead, remove.
 * An ARIA menu button — Enter or Space opens it on the first item, ↓/↑ move,
 * Home/End jump, Esc closes it and gives focus back to the button.
 */

export interface MemberMenuProps {
  readonly member: TeamMember;
  readonly onEditRole: () => void;
  readonly onToggleLead: () => void;
  readonly onRemove: () => void;
}

export function MemberMenu({
  member,
  onEditRole,
  onToggleLead,
  onRemove,
}: MemberMenuProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLUListElement>(null);

  const items = (): HTMLElement[] => [
    ...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []),
  ];

  useEffect(() => {
    if (!open) return undefined;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onPointer = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('mousedown', onPointer);
    };
  }, [open]);

  const close = (): void => {
    setOpen(false);
    button.current?.focus();
  };
  const choose = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  const onMenuKey = (event: React.KeyboardEvent): void => {
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLElement);
    const move = (to: number): void => {
      event.preventDefault();
      list[(to + list.length) % list.length]?.focus();
    };
    if (event.key === 'ArrowDown') move(index + 1);
    else if (event.key === 'ArrowUp') move(index - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(list.length - 1);
    else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'Tab') setOpen(false);
  };

  const item =
    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-surface-hover focus:bg-accent-surface';
  return (
    <div className="relative">
      <button
        ref={button}
        type="button"
        aria-label={`Actions for ${member.fullName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          setOpen((value) => !value);
        }}
        className="rounded-md p-1 text-fg-muted hover:bg-surface-hover"
      >
        <EllipsisVertical aria-hidden="true" className="size-4" />
      </button>
      {open && (
        <ul
          ref={menu}
          id={menuId}
          role="menu"
          aria-label={`Actions for ${member.fullName}`}
          onKeyDown={onMenuKey}
          className="absolute right-0 z-30 mt-1 w-52 rounded-lg border border-line bg-surface-raised p-1 shadow-[var(--ci-shadow-popover)]"
        >
          <li role="none">
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={choose(onEditRole)}
              className={item}
            >
              <Pencil aria-hidden="true" className="size-4" />
              Edit role…
            </button>
          </li>
          <li role="none">
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={choose(onToggleLead)}
              className={item}
            >
              <Crown aria-hidden="true" className="size-4" />
              {member.isLead ? 'Stop being lead' : 'Make lead'}
            </button>
          </li>
          <li role="none">
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={choose(onRemove)}
              className={`${item} text-danger`}
            >
              <UserMinus aria-hidden="true" className="size-4" />
              Remove from team
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}

export interface RoleDialogProps {
  readonly member: TeamMember;
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onSave: (roleLabel: string | null) => void;
}

/** "Edit role…": a free label such as "Backend" or "Designer", up to 40 characters. */
export function RoleDialog({ member, busy, onCancel, onSave }: RoleDialogProps): React.JSX.Element {
  const [value, setValue] = useState(member.roleLabel ?? '');
  const fieldId = useId();
  const hintId = useId();
  return (
    <Dialog title={`${member.fullName}’s role`} onClose={onCancel}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(value.trim() === '' ? null : value.trim());
        }}
      >
        <label htmlFor={fieldId} className="text-sm font-medium">
          Role in this team
        </label>
        <input
          id={fieldId}
          type="text"
          value={value}
          maxLength={TEAM_ROLE_LABEL_MAX}
          aria-describedby={hintId}
          onChange={(event) => {
            setValue(event.target.value);
          }}
          className="rounded-md border border-line bg-surface px-2 py-1.5"
        />
        <p id={hintId} className="text-xs text-fg-muted">
          A short label such as “Backend” or “Presenter”, up to {TEAM_ROLE_LABEL_MAX} characters.
          Leave it empty for no role.
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-line px-3 py-1.5 hover:bg-surface-hover"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-accent px-3 py-1.5 font-medium text-on-accent hover:bg-accent-hover disabled:opacity-60"
          >
            Save role
          </button>
        </div>
      </form>
    </Dialog>
  );
}
