import { TEAM_ROLE_LABEL_MAX, type TeamPerson } from '@compintel/contracts';
import { Crown, X } from 'lucide-react';
import { useId, useMemo, useState } from 'react';

import { StudentPicker } from './StudentPicker.js';
import {
  validateTeamForm,
  withLead,
  type TeamFormErrors,
  type TeamFormState,
} from './team-form.js';

/**
 * The create/edit form (WP-18 step 6): name, description, the skills the team
 * needs and — on create — its first members and, for an administrator, the
 * primary mentor. Errors sit under their field and the first one gets focus.
 */

export interface TeamFormProps {
  readonly initial: TeamFormState;
  readonly mode: 'create' | 'edit';
  /** For an administrator on create: the professors, and whether "me" is one. */
  readonly primaryChoice?: {
    readonly professors: readonly TeamPerson[];
    readonly selfAllowed: boolean;
  };
  readonly busy: boolean;
  /** The server's complaint, e.g. the name is taken. */
  readonly serverError: string | undefined;
  readonly onSubmit: (form: TeamFormState) => void;
  readonly onCancel: () => void;
}

const field = 'rounded-md border border-line bg-surface px-2 py-1.5 aria-invalid:border-danger';

function FieldError({ id, text }: { readonly id: string; readonly text: string | undefined }) {
  if (text === undefined) return null;
  return (
    <p id={id} className="text-sm text-danger">
      {text}
    </p>
  );
}

export function TeamForm(props: TeamFormProps): React.JSX.Element {
  const { mode, primaryChoice } = props;
  const [form, setForm] = useState(props.initial);
  const [errors, setErrors] = useState<TeamFormErrors>({});
  const ids = {
    name: useId(),
    description: useId(),
    targets: useId(),
    primary: useId(),
    error: useId(),
  };
  const exclude = useMemo(
    () => new Set(form.members.map((member) => member.studentId)),
    [form.members],
  );
  const needsPrimary = primaryChoice !== undefined && !primaryChoice.selfAllowed;
  const set = (patch: Partial<TeamFormState>): void => {
    setForm({ ...form, ...patch });
  };

  return (
    <form
      noValidate
      className="flex max-w-2xl flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const found = validateTeamForm(form, needsPrimary);
        setErrors(found);
        const first = Object.keys(found)[0];
        if (first === undefined) props.onSubmit(form);
        else document.getElementById(ids[first as keyof typeof ids])?.focus();
      }}
    >
      <div className="flex flex-col gap-1">
        <label htmlFor={ids.name} className="font-medium">
          Team name <span className="text-fg-muted">(required)</span>
        </label>
        <input
          id={ids.name}
          type="text"
          value={form.name}
          aria-invalid={errors.name !== undefined}
          aria-describedby={errors.name === undefined ? undefined : `${ids.name}-error`}
          onChange={(event) => {
            set({ name: event.target.value });
          }}
          className={field}
        />
        <FieldError id={`${ids.name}-error`} text={errors.name} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={ids.description} className="font-medium">
          Description
        </label>
        <textarea
          id={ids.description}
          value={form.description}
          rows={3}
          maxLength={500}
          onChange={(event) => {
            set({ description: event.target.value });
          }}
          className={field}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={ids.targets} className="font-medium">
          Skills this team needs
        </label>
        <input
          id={ids.targets}
          type="text"
          value={form.targets}
          placeholder="e.g. Python, Machine learning, UI design"
          aria-invalid={errors.targets !== undefined}
          aria-describedby={`${ids.targets}-hint`}
          onChange={(event) => {
            set({ targets: event.target.value });
          }}
          className={field}
        />
        <p id={`${ids.targets}-hint`} className="text-xs text-fg-muted">
          {errors.targets ??
            'Separate skills with commas. Optional — they let the team page show what is missing.'}
        </p>
      </div>

      {mode === 'create' && (
        <fieldset className="flex flex-col gap-2">
          <legend className="font-medium">First members</legend>
          <StudentPicker
            label="Add a student"
            exclude={exclude}
            onPick={(student) => {
              set({
                members: [
                  ...form.members,
                  {
                    studentId: student.id,
                    fullName: student.fullName,
                    universityId: student.universityId,
                    roleLabel: '',
                    isLead: false,
                  },
                ],
              });
            }}
          />
          {form.members.length === 0 ? (
            <p className="text-sm text-fg-muted">None yet — you can also add members later.</p>
          ) : (
            <ul className="flex flex-col gap-1.5" aria-label="Members to add">
              {form.members.map((member) => (
                <li key={member.studentId} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{member.fullName}</span>
                  <span className="font-mono text-fg-muted">{member.universityId}</span>
                  <input
                    type="text"
                    aria-label={`Role of ${member.fullName}`}
                    placeholder="Role (optional)"
                    maxLength={TEAM_ROLE_LABEL_MAX}
                    value={member.roleLabel}
                    onChange={(event) => {
                      set({
                        members: form.members.map((row) =>
                          row.studentId === member.studentId
                            ? { ...row, roleLabel: event.target.value }
                            : row,
                        ),
                      });
                    }}
                    className="w-40 rounded-md border border-line bg-surface px-2 py-1"
                  />
                  <button
                    type="button"
                    aria-pressed={member.isLead}
                    onClick={() => {
                      set({ members: withLead(form.members, member.studentId) });
                    }}
                    className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 hover:bg-surface-hover aria-pressed:border-warning aria-pressed:bg-warning-surface"
                  >
                    <Crown aria-hidden="true" className="size-3.5" />
                    Lead
                  </button>
                  <button
                    type="button"
                    aria-label={`Take ${member.fullName} off the list`}
                    onClick={() => {
                      set({
                        members: form.members.filter((row) => row.studentId !== member.studentId),
                      });
                    }}
                    className="rounded-md p-1 text-fg-muted hover:bg-surface-hover"
                  >
                    <X aria-hidden="true" className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <FieldError id={`${ids.error}-members`} text={errors.members} />
        </fieldset>
      )}

      {mode === 'create' && primaryChoice !== undefined && (
        <div className="flex flex-col gap-1">
          <label htmlFor={ids.primary} className="font-medium">
            Primary mentor
          </label>
          <select
            id={ids.primary}
            value={form.primaryUserId}
            aria-invalid={errors.primary !== undefined}
            aria-describedby={errors.primary === undefined ? undefined : `${ids.primary}-error`}
            onChange={(event) => {
              set({ primaryUserId: event.target.value });
            }}
            className={field}
          >
            <option value="">{primaryChoice.selfAllowed ? 'Me' : 'Choose a professor'}</option>
            {primaryChoice.professors.map((person) => (
              <option key={person.userId} value={person.userId}>
                {person.displayName}
              </option>
            ))}
          </select>
          <FieldError id={`${ids.primary}-error`} text={errors.primary} />
        </div>
      )}

      {props.serverError !== undefined && (
        <p role="alert" className="rounded-md bg-danger-surface p-3 text-sm">
          {props.serverError}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={props.busy}
          className="rounded-md bg-accent px-4 py-2 font-medium text-on-accent hover:bg-accent-hover disabled:opacity-60"
        >
          {mode === 'create' ? 'Create team' : 'Save changes'}
        </button>
        <button
          type="button"
          onClick={props.onCancel}
          className="rounded-md border border-line px-4 py-2 hover:bg-surface-hover"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
