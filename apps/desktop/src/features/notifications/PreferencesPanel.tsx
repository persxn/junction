import {
  NOTIFICATION_TYPE_LABELS,
  type NotificationPreference,
  type NotificationType,
  type Thresholds,
} from '@compintel/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';

import { getPreferences, PREFERENCES_KEY, savePreferences } from '../../api/notifications.js';
import { Skeleton } from '../../components/Skeleton.js';
import { useToast } from '../../components/toast/ToastProvider.js';
import { useBackendConnection } from '../../shell/connection-context.js';
import { problemText } from '../competitions/use-competition-actions.js';

/**
 * Per-type preferences (WP-23, R110): on or off, which days before a deadline
 * remind you, and whether urgent ones reach a Windows notification. Nothing is
 * stored until you save; until then the defaults apply.
 */

const DAY_CHOICES = [14, 7, 3, 2, 1] as const;

export function PreferencesPanel(): React.JSX.Element {
  const connection = useBackendConnection();
  const client = useQueryClient();
  const toast = useToast();
  const id = useId();
  const stored = useQuery({ queryKey: PREFERENCES_KEY, queryFn: () => getPreferences(connection) });
  // The person's edits; until they touch anything, what the server holds.
  const [edits, setDraft] = useState<NotificationPreference[] | undefined>(undefined);
  const draft = edits ?? stored.data?.preferences;
  const save = useMutation({
    mutationFn: (preferences: readonly NotificationPreference[]) =>
      savePreferences(connection, {
        preferences: preferences.map(({ type, isEnabled, thresholds, toastEnabled }) => ({
          type,
          isEnabled,
          thresholds,
          toastEnabled,
        })),
      }),
    onSuccess: (saved) => {
      client.setQueryData(PREFERENCES_KEY, saved);
      toast.show({ tone: 'success', title: 'Notification settings saved' });
    },
    onError: (error) => {
      toast.show({ tone: 'danger', title: 'Settings not saved', description: problemText(error) });
    },
  });

  if (draft === undefined) {
    return stored.isError ? (
      <p className="text-sm text-danger">{problemText(stored.error)}</p>
    ) : (
      <Skeleton lines={4} label="Loading notification settings" />
    );
  }
  const change = (type: NotificationType, patch: Partial<NotificationPreference>): void => {
    setDraft(draft.map((row) => (row.type === type ? { ...row, ...patch } : row)));
  };
  const toggleDay = (row: NotificationPreference, day: number): void => {
    const current: Thresholds = row.thresholds!;
    const days = current.days.includes(day)
      ? current.days.filter((value) => value !== day)
      : [...current.days, day].sort((a, b) => b - a);
    change(row.type, { thresholds: { ...current, days } });
  };

  return (
    <form
      aria-labelledby={`${id}-title`}
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate(draft);
      }}
      className="flex flex-col gap-3 rounded-lg border border-line p-3"
    >
      <h2 id={`${id}-title`} className="text-md">
        Notification settings
      </h2>
      <ul className="flex flex-col gap-2">
        {draft.map((row) => (
          <li key={row.type} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <label className="flex w-56 items-center gap-1.5 font-medium">
              <input
                type="checkbox"
                checked={row.isEnabled}
                onChange={(event) => {
                  change(row.type, { isEnabled: event.target.checked });
                }}
              />
              {NOTIFICATION_TYPE_LABELS[row.type]}
            </label>
            {row.thresholds !== null && (
              <fieldset className="flex flex-wrap items-center gap-2" disabled={!row.isEnabled}>
                <legend className="sr-only">{`${NOTIFICATION_TYPE_LABELS[row.type]}: remind me`}</legend>
                {DAY_CHOICES.map((day) => (
                  <label key={day} className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={row.thresholds!.days.includes(day)}
                      onChange={() => {
                        toggleDay(row, day);
                      }}
                    />
                    {day === 1 ? '1 day before' : `${String(day)} days`}
                  </label>
                ))}
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={row.thresholds.dueDay}
                    onChange={(event) => {
                      change(row.type, {
                        thresholds: { ...row.thresholds!, dueDay: event.target.checked },
                      });
                    }}
                  />
                  On the due day
                </label>
              </fieldset>
            )}
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={row.toastEnabled}
                disabled={!row.isEnabled}
                onChange={(event) => {
                  change(row.type, { toastEnabled: event.target.checked });
                }}
              />
              Windows notification when urgent
            </label>
          </li>
        ))}
      </ul>
      <button
        type="submit"
        disabled={save.isPending}
        className="w-fit rounded-md bg-accent px-3 py-1.5 text-sm text-on-accent disabled:opacity-50"
      >
        Save settings
      </button>
    </form>
  );
}
