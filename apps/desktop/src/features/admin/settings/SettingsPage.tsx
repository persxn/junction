import type { StudentSettings } from '@compintel/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GraduationCap, MapPin } from 'lucide-react';

import { isApiProblem } from '../../../api/problem.js';
import { saveStudentSettings, studentSettings } from '../../../api/students.js';
import { Guide } from '../../../components/Guide.js';
import { Skeleton } from '../../../components/Skeleton.js';
import { useToast } from '../../../components/toast/ToastProvider.js';
import { useBackendConnection } from '../../../shell/connection-context.js';

/**
 * Admin → Campus & settings. WP-17 brings the first card, "Students"; the
 * campus location and the other settings arrive with their own work packages
 * and are named here so the page does not look finished when it is not.
 */

const SETTINGS_KEY = ['admin', 'settings', 'students'] as const;

function Toggle(props: {
  readonly label: string;
  readonly hint: string;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly onChange: (next: boolean) => void;
}): React.JSX.Element {
  return (
    <label className="flex items-start gap-3">
      <input
        type="checkbox"
        role="switch"
        className="mt-1"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(event) => {
          props.onChange(event.target.checked);
        }}
      />
      <span>
        <span className="font-medium">{props.label}</span>
        <span className="block text-sm text-fg-muted">{props.hint}</span>
      </span>
    </label>
  );
}

function StudentsCard(): React.JSX.Element {
  const connection = useBackendConnection();
  const client = useQueryClient();
  const toast = useToast();
  const settings = useQuery({ queryKey: SETTINGS_KEY, queryFn: () => studentSettings(connection) });
  const save = useMutation({
    mutationFn: (next: StudentSettings) => saveStudentSettings(connection, next),
    onMutate: (next) => {
      const before = client.getQueryData<StudentSettings>(SETTINGS_KEY);
      client.setQueryData(SETTINGS_KEY, next);
      return { before };
    },
    onError: (cause, _next, context) => {
      if (context?.before !== undefined) client.setQueryData(SETTINGS_KEY, context.before);
      toast.show({
        tone: 'danger',
        title: 'The setting was not saved',
        description: isApiProblem(cause)
          ? (cause.detail ?? cause.title)
          : 'The local service did not answer.',
      });
    },
    onSuccess: (saved) => {
      client.setQueryData(SETTINGS_KEY, saved);
      void client.invalidateQueries({ queryKey: ['students', 'options'] });
      toast.show({ tone: 'success', title: 'Student settings saved' });
    },
  });

  return (
    <section
      aria-labelledby="students-settings-heading"
      className="flex flex-col gap-4 rounded-lg border border-line bg-surface-raised p-5"
    >
      <h2 id="students-settings-heading" className="flex items-center gap-2 text-md">
        <GraduationCap aria-hidden="true" className="size-5 text-fg-subtle" />
        Students
      </h2>
      {settings.isPending && <Skeleton lines={2} label="Loading the student settings" />}
      {settings.isError && (
        <p role="alert" className="text-sm text-danger">
          The student settings could not be loaded.
        </p>
      )}
      {settings.data !== undefined && (
        <>
          <Toggle
            label="Keep students’ phone numbers"
            hint="Off by default. When on, the student form and the import accept a phone number. Turning it off again hides the numbers already kept; it does not delete them."
            checked={settings.data.phoneEnabled}
            disabled={save.isPending}
            onChange={(phoneEnabled) => {
              save.mutate({ ...settings.data, phoneEnabled });
            }}
          />
          <Toggle
            label="Allow students from other institutions"
            hint="Off by default. When on, a student can be marked as studying elsewhere — for a mixed team, for example."
            checked={settings.data.allowExternal}
            disabled={save.isPending}
            onChange={(allowExternal) => {
              save.mutate({ ...settings.data, allowExternal });
            }}
          />
        </>
      )}
    </section>
  );
}

export function SettingsPage(): React.JSX.Element {
  return (
    <section aria-labelledby="settings-heading" className="flex max-w-3xl flex-col gap-5">
      <div>
        <h1 id="settings-heading" className="font-display text-xl">
          Campus &amp; settings
        </h1>
        <p className="text-fg-muted">Where the institution is, and how the app behaves.</p>
      </div>
      <Guide id="admin-settings" title="About these settings">
        <p>
          These choices apply to everyone in the institution, and each change is recorded in the
          audit log with your name. Personal details are off unless you switch them on: CompIntel
          keeps as little about students as it can.
        </p>
      </Guide>
      <StudentsCard />
      <section
        aria-labelledby="campus-heading"
        className="flex flex-col gap-2 rounded-lg border border-dashed border-line p-5 text-fg-muted"
      >
        <h2 id="campus-heading" className="flex items-center gap-2 text-md text-fg">
          <MapPin aria-hidden="true" className="size-5 text-fg-subtle" />
          Campus location
        </h2>
        <p className="text-sm">
          The campus address and travel distances are set here once that work package is built.
          Until then the location chosen during setup is used.
        </p>
      </section>
    </section>
  );
}
