import {
  PROGRAM_LABELS,
  STUDENT_PROGRAMS,
  type StudentFormOptions,
  type StudentProgram,
} from '@compintel/contracts';
import { useId, useState } from 'react';

import { validateForm, type StudentFormErrors, type StudentFormState } from './form-model.js';

/**
 * The add/edit form (WP-17 step 6). The phone field exists only while an
 * administrator has switched phone numbers on; the "another institution"
 * fields only while external students are allowed. Errors sit under their
 * field, are announced, and the first one takes focus on a failed save.
 */

export interface StudentFormProps {
  readonly initial: StudentFormState;
  readonly options: StudentFormOptions;
  readonly mode: 'create' | 'edit';
  readonly busy: boolean;
  /** A server refusal, in words, shown above the buttons. */
  readonly serverError: string | undefined;
  readonly onSubmit: (form: StudentFormState) => void;
  readonly onCancel: () => void;
}

const INPUT =
  'rounded-md border border-line bg-surface px-3 py-2 text-fg aria-[invalid=true]:border-danger';

export function StudentForm(props: StudentFormProps): React.JSX.Element {
  const base = useId();
  const [form, setForm] = useState(props.initial);
  const [errors, setErrors] = useState<StudentFormErrors>({});
  const { settings, departments } = props.options;
  const set = <K extends keyof StudentFormState>(key: K, value: StudentFormState[K]): void => {
    setForm((previous) => ({ ...previous, [key]: value }));
  };
  const id = (key: string): string => `${base}-${key}`;

  const text = (
    key: keyof StudentFormState,
    label: string,
    options: { readonly hint?: string; readonly type?: string; readonly required?: boolean } = {},
  ): React.JSX.Element => {
    const error = errors[key];
    const describedBy = [
      options.hint === undefined ? '' : id(`${key}-hint`),
      error === undefined ? '' : id(`${key}-error`),
    ]
      .filter((part) => part !== '')
      .join(' ');
    return (
      <div className="flex flex-col gap-1">
        <label htmlFor={id(key)} className="font-medium">
          {label}
          {options.required === true && <span className="text-fg-muted"> (required)</span>}
        </label>
        <input
          id={id(key)}
          type={options.type ?? 'text'}
          value={String(form[key])}
          aria-invalid={error !== undefined}
          aria-describedby={describedBy === '' ? undefined : describedBy}
          onChange={(event) => {
            set(key, event.target.value as never);
          }}
          className={INPUT}
        />
        {options.hint !== undefined && (
          <p id={id(`${key}-hint`)} className="text-sm text-fg-subtle">
            {options.hint}
          </p>
        )}
        {error !== undefined && (
          <p id={id(`${key}-error`)} className="text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    );
  };

  return (
    <form
      noValidate
      className="flex max-w-2xl flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const found = validateForm(form, settings);
        setErrors(found);
        const first = Object.keys(found)[0];
        if (first !== undefined) {
          document.getElementById(id(first))?.focus();
          return;
        }
        props.onSubmit(form);
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {text('universityId', 'Roll number', {
          required: true,
          hint: 'As printed on the ID card, e.g. 21CS1042.',
        })}
        {text('fullName', 'Full name', { required: true })}
        {text('preferredName', 'Preferred name', {
          hint: 'What the student likes to be called, if different.',
        })}
        {text('institutionalEmail', 'College e-mail', { type: 'email' })}
        {settings.phoneEnabled && text('phone', 'Phone', { type: 'tel' })}
        <div className="flex flex-col gap-1">
          <label htmlFor={id('program')} className="font-medium">
            Programme <span className="text-fg-muted">(required)</span>
          </label>
          <select
            id={id('program')}
            value={form.program}
            onChange={(event) => {
              set('program', event.target.value as StudentProgram);
            }}
            className={INPUT}
          >
            {STUDENT_PROGRAMS.map((program) => (
              <option key={program} value={program}>
                {PROGRAM_LABELS[program]}
              </option>
            ))}
          </select>
        </div>
        {text('branch', 'Branch', { hint: 'e.g. Computer Science and Engineering.' })}
        {text('graduationYear', 'Graduation year', {
          hint: 'The year the student is expected to finish.',
        })}
        <div className="flex flex-col gap-1">
          <label htmlFor={id('homeDepartmentId')} className="font-medium">
            Department
          </label>
          <select
            id={id('homeDepartmentId')}
            value={form.homeDepartmentId}
            onChange={(event) => {
              set('homeDepartmentId', event.target.value);
            }}
            className={INPUT}
          >
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {settings.allowExternal && (
        <fieldset className="flex flex-col gap-2 rounded-md border border-line p-3">
          <legend className="px-1 font-medium">Another institution</legend>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.isExternal}
              onChange={(event) => {
                set('isExternal', event.target.checked);
              }}
            />
            This student studies at another institution
          </label>
          {form.isExternal && text('externalInstitution', 'Institution')}
        </fieldset>
      )}

      <div className="flex flex-col gap-1">
        <label htmlFor={id('notes')} className="font-medium">
          Notes
        </label>
        <textarea
          id={id('notes')}
          rows={3}
          value={form.notes}
          maxLength={500}
          aria-invalid={errors.notes !== undefined}
          onChange={(event) => {
            set('notes', event.target.value);
          }}
          className={INPUT}
        />
        <p className="text-sm text-fg-subtle">
          Only for mentoring. Keep it short and factual; {500 - form.notes.length} characters left.
        </p>
      </div>

      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          className="mt-1"
          checked={form.privacyNoticeShown}
          disabled={props.mode === 'edit' && props.initial.privacyNoticeShown}
          onChange={(event) => {
            set('privacyNoticeShown', event.target.checked);
          }}
        />
        <span>
          The student has been shown the privacy notice
          <span className="block text-sm text-fg-subtle">
            Tick this once you have told the student what Junction keeps about them and why. The
            date is recorded.
          </span>
        </span>
      </label>

      {props.mode === 'create' && (
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.mentorMe}
            onChange={(event) => {
              set('mentorMe', event.target.checked);
            }}
          />
          I mentor this student
        </label>
      )}

      {props.serverError !== undefined && (
        <p role="alert" className="rounded-md bg-danger-surface p-3 text-sm text-danger">
          {props.serverError}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={props.busy}
          className="rounded-md bg-accent px-4 py-2 font-medium text-on-accent hover:bg-accent-hover disabled:opacity-60"
        >
          {props.busy ? 'Saving…' : props.mode === 'create' ? 'Add student' : 'Save changes'}
        </button>
        <button
          type="button"
          onClick={props.onCancel}
          className="rounded-md px-4 py-2 hover:bg-surface-hover"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
