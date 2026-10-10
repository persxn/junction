import type { SetupResult } from '@compintel/contracts';
import { Check, Copy, KeyRound, PartyPopper, Save, ShieldAlert, Sparkles } from 'lucide-react';
import { useState } from 'react';

import { Field } from '../Field.js';
import { Note, type StepProps } from './BasicSteps.js';

/**
 * The last three steps: choosing the backup passphrase, saving what comes back,
 * and being told it is over (rulings R41 and R42).
 *
 * The recovery step is the one place in the whole application where Next is
 * deliberately hard to reach: R41 says the wizard may not finish until the user
 * has exported the file and said, twice and explicitly, that both secrets are
 * somewhere safe. Nothing here can be recovered afterwards.
 */

export function PassphraseStep({ values, errors, onChange }: StepProps): React.JSX.Element {
  return (
    <>
      <Field
        label="Backup passphrase"
        type="password"
        value={values.backupPassphrase}
        error={errors.backupPassphrase}
        onChange={(value) => {
          onChange('backupPassphrase', value);
        }}
        autoComplete="new-password"
        hint="At least 12 characters, and not the same as your Junction password."
        autoFocus
      />
      <Field
        label="Passphrase again"
        type="password"
        value={values.backupPassphraseConfirm}
        error={errors.backupPassphraseConfirm}
        onChange={(value) => {
          onChange('backupPassphraseConfirm', value);
        }}
        autoComplete="new-password"
      />
      <p className="flex gap-2.5 rounded-md border-l-4 border-warning bg-warning-surface p-3 text-sm text-warning">
        <ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <span>
          Backups are encrypted with this passphrase. If you lose both it and the recovery file from
          the next step, <strong>your backups cannot be read by anyone</strong> — not by us, not by
          anybody. Write it down before you continue.
        </span>
      </p>
    </>
  );
}

export interface RecoveryStepProps {
  readonly result: SetupResult;
  readonly savedTo: string | undefined;
  readonly codeConfirmed: boolean;
  readonly fileConfirmed: boolean;
  readonly onSaveFile: () => void;
  readonly onConfirmCode: (value: boolean) => void;
  readonly onConfirmFile: (value: boolean) => void;
}

export function RecoveryStep({
  result,
  savedTo,
  codeConfirmed,
  fileConfirmed,
  onSaveFile,
  onConfirmCode,
  onConfirmFile,
}: RecoveryStepProps): React.JSX.Element {
  const [copied, setCopied] = useState(false);

  return (
    <>
      <div className="flex flex-col gap-2 rounded-md border border-line bg-surface-raised p-4">
        <p className="flex items-center gap-2 font-medium">
          <KeyRound aria-hidden="true" className="size-4 text-accent" />
          Administrator recovery code
        </p>
        <p className="text-sm text-fg-muted">
          Gets you back in if every administrator is locked out. It is shown once and stored only as
          a hash, so nobody — including Junction — can read it back.
        </p>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-2 font-mono text-sm break-all select-all">
            {result.recoveryCode}
          </code>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(result.recoveryCode ?? '').then(
                () => {
                  setCopied(true);
                },
                () => {
                  setCopied(false);
                },
              );
            }}
            className="flex shrink-0 items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 font-medium hover:bg-surface-hover"
          >
            {copied ? (
              <Check aria-hidden="true" className="size-4 text-success" />
            ) : (
              <Copy aria-hidden="true" className="size-4" />
            )}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-md border border-line bg-surface-raised p-4">
        <p className="flex items-center gap-2 font-medium">
          <Save aria-hidden="true" className="size-4 text-accent" />
          Backup recovery file
        </p>
        <p className="text-sm text-fg-muted">
          Holds the encrypted backup key and instructions for reading a backup with the standard{' '}
          <code className="font-mono">age</code> tool, with or without Junction. Save it somewhere
          other than this machine.
        </p>
        <div>
          <button
            type="button"
            onClick={onSaveFile}
            className="flex items-center gap-2 rounded-md bg-accent px-3 py-2 font-medium text-on-accent hover:bg-accent-hover"
          >
            <Save aria-hidden="true" className="size-4" />
            {savedTo === undefined ? 'Save recovery file…' : 'Save again…'}
          </button>
        </div>
        <p aria-live="polite" className="min-h-5 text-sm">
          {savedTo === undefined ? (
            <span className="text-fg-subtle">Not saved yet.</span>
          ) : (
            <span className="flex items-start gap-1.5 text-success">
              <Check aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              <span className="break-all">Saved to {savedTo}</span>
            </span>
          )}
        </p>
      </div>

      <Confirmation
        checked={codeConfirmed}
        onChange={onConfirmCode}
        label="I have saved the administrator recovery code somewhere safe."
      />
      <Confirmation
        checked={fileConfirmed}
        onChange={onConfirmFile}
        label="I have saved the recovery file somewhere other than this machine."
        disabled={savedTo === undefined}
        disabledHint="Save the file first."
      />
    </>
  );
}

function Confirmation({
  checked,
  onChange,
  label,
  disabled = false,
  disabledHint,
}: {
  readonly checked: boolean;
  readonly onChange: (value: boolean) => void;
  readonly label: string;
  readonly disabled?: boolean;
  readonly disabledHint?: string;
}): React.JSX.Element {
  return (
    <label className={'flex items-start gap-2.5 ' + (disabled ? 'text-fg-subtle' : '')}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
        className="mt-0.5 size-4 shrink-0 accent-[var(--ci-color-accent)]"
      />
      <span>
        {label}
        {disabled && disabledHint !== undefined && (
          <span className="block text-sm text-fg-subtle">{disabledHint}</span>
        )}
      </span>
    </label>
  );
}

export function WelcomeStep(): React.JSX.Element {
  return (
    <>
      <p>
        Junction finds hackathons, CTFs and coding contests worth entering, keeps track of who is
        doing what, and reminds you before deadlines pass — for a department and its students, or
        for a student on their own.
      </p>
      <p className="text-fg-muted">
        Everything runs on this machine. No data leaves it except the requests Junction makes to
        public event sites, and any encrypted backups you tell it to write.
      </p>
      <Note icon={Sparkles}>
        A student needs about a minute and no password. A department needs about two: have ready an
        e-mail address event sites can reach you at, and a folder for backups.
      </Note>
    </>
  );
}

export function DoneStep({
  organizationName,
  email,
}: {
  readonly organizationName: string;
  readonly email: string;
}): React.JSX.Element {
  return (
    <>
      <p className="flex items-center gap-2.5 rounded-md border-l-4 border-success bg-success-surface p-3 text-success">
        <PartyPopper aria-hidden="true" className="size-5 shrink-0" />
        <span>
          Junction is set up for <strong>{organizationName}</strong>.
        </span>
      </p>
      <p>
        Sign in as <strong>{email}</strong> with the password you chose.
      </p>
      <p className="text-fg-muted">
        Next, you will probably want to add your colleagues under Admin → Users, and check the
        sources Junction is allowed to read under Admin → Sources &amp; scraper.
      </p>
    </>
  );
}
