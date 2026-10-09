import type { Notification } from '@compintel/contracts';
import { AlarmClock } from 'lucide-react';
import { useId, useState } from 'react';

import { chosenTime, snoozeChoices } from './notification-model.js';

/**
 * R111's four snooze choices as a disclosure: three buttons and a date-time
 * field, all reachable by Tab, Escape closing it. Times are Indian time.
 */
export function SnoozeMenu({
  notification,
  now,
  onSnooze,
}: {
  readonly notification: Notification;
  readonly now: number;
  readonly onSnooze: (until: number) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const id = useId();
  const chosen = chosenTime(value, now);
  const pick = (until: number): void => {
    setOpen(false);
    onSnooze(until);
  };
  return (
    <div
      className="relative"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={`Snooze: ${notification.title}`}
        onClick={() => {
          setOpen((value) => !value);
        }}
        className="flex items-center gap-1 rounded-md px-2 py-1 text-sm hover:bg-surface-hover"
      >
        <AlarmClock aria-hidden="true" className="size-3.5" />
        Snooze
      </button>
      {open && (
        <div
          id={id}
          role="group"
          aria-label="Snooze until"
          className="absolute right-0 z-20 mt-1 flex w-64 flex-col gap-1 rounded-lg border border-line bg-surface-raised p-2 shadow-[var(--ci-shadow-popover)]"
        >
          {snoozeChoices(now, notification.dueAt).map((choice) => (
            <button
              key={choice.label}
              type="button"
              onClick={() => {
                pick(choice.until);
              }}
              className="rounded-md px-2 py-1 text-left text-sm hover:bg-surface-hover"
            >
              {choice.label}
            </button>
          ))}
          <label htmlFor={`${id}-at`} className="mt-1 text-sm">
            Or choose a time (Indian time)
          </label>
          <div className="flex gap-1">
            <input
              id={`${id}-at`}
              type="datetime-local"
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
              }}
              className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1 text-sm"
            />
            <button
              type="button"
              disabled={chosen === undefined}
              onClick={() => {
                if (chosen !== undefined) pick(chosen);
              }}
              className="rounded-md border border-line px-2 py-1 text-sm hover:bg-surface-hover disabled:opacity-50"
            >
              Snooze
            </button>
          </div>
          <p className="text-xs text-fg-muted">It comes back within five minutes of that time.</p>
        </div>
      )}
    </div>
  );
}
