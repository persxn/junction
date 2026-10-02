import type { StudentDetail } from '@compintel/contracts';
import { useId, useState } from 'react';

import { Dialog } from '../../components/Dialog.js';

/**
 * Erasure (R92), behind a dialog that asks for the roll number again: it is
 * irreversible, so it is never one click. The words say exactly what goes and
 * what stays.
 */
export function EraseDialog(props: {
  readonly student: StudentDetail;
  readonly busy: boolean;
  readonly error: string | undefined;
  readonly onCancel: () => void;
  readonly onErase: (universityId: string) => void;
}): React.JSX.Element {
  const inputId = useId();
  const [typed, setTyped] = useState('');
  const matches =
    typed.replace(/\s+/g, '').toUpperCase() ===
    props.student.universityId.replace(/\s+/g, '').toUpperCase();
  return (
    <Dialog title={`Erase ${props.student.fullName}?`} onClose={props.onCancel}>
      <p className="text-fg-muted">
        Erasing removes this student’s name, roll number, e-mail, phone and notes for good, and
        deletes their skills, interests, achievements and mentorships. Team and competition history
        keeps an anonymous “Erased student” in their place. This cannot be undone.
      </p>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (matches) props.onErase(typed);
        }}
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor={inputId} className="font-medium">
            Type the roll number <span className="font-mono">{props.student.universityId}</span> to
            confirm
          </label>
          <input
            id={inputId}
            value={typed}
            autoComplete="off"
            onChange={(event) => {
              setTyped(event.target.value);
            }}
            className="rounded-md border border-line bg-surface px-3 py-2 font-mono"
          />
        </div>
        {props.error !== undefined && (
          <p role="alert" className="text-sm text-danger">
            {props.error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={props.onCancel}
            className="rounded-md px-3 py-1.5 hover:bg-surface-hover"
          >
            Keep the record
          </button>
          <button
            type="submit"
            disabled={!matches || props.busy}
            className="rounded-md bg-danger px-3 py-1.5 font-medium text-on-accent disabled:opacity-50"
          >
            Erase for good
          </button>
        </div>
      </form>
    </Dialog>
  );
}
