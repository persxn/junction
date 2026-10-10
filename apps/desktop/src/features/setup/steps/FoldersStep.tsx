import type { PathCheckReason, PathCheckResult } from '@compintel/contracts';
import { AlertTriangle, Check, FolderOpen, HardDrive, Loader2 } from 'lucide-react';

import { Field } from '../Field.js';
import { Note, type StepProps } from './BasicSteps.js';

/**
 * Ruling R43's two folders.
 *
 * The data folder is fixed for this process — the shell passed it on the
 * command line — so it is shown and not offered. The backup folder is picked in
 * a native dialog and then **checked by the backend**, which write-probes it:
 * the UI never decides that a folder is usable, because the UI is not the
 * process that will have to write there at one in the afternoon.
 */

const REASONS: Readonly<Record<PathCheckReason, string>> = {
  MISSING: 'That folder is not there any more.',
  NOT_A_DIRECTORY: 'That is a file, not a folder.',
  NOT_WRITABLE: 'Junction cannot write there. Pick a folder you own, or change its permissions.',
  INSIDE_DATA_DIR:
    'That folder is inside Junction’s own data folder. A backup kept there is lost with everything else.',
  LOW_SPACE: 'There is less than 1 GB free on that drive.',
};

function gigabytes(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export interface FoldersStepProps extends StepProps {
  /** From the shell; read-only here, an installer choice in WP-31. */
  readonly dataDir: string;
  readonly checking: boolean;
  readonly check: PathCheckResult | undefined;
  readonly onPickFolder: () => void;
}

export function FoldersStep({
  values,
  errors,
  dataDir,
  checking,
  check,
  onPickFolder,
}: FoldersStepProps): React.JSX.Element {
  return (
    <>
      <Field
        label="Data folder"
        value={dataDir}
        onChange={() => undefined}
        readOnly
        hint="Where the database, logs and models live. Changing it is an installer option."
      />

      <div className="flex flex-col gap-1.5">
        <p className="font-medium">Backup folder</p>
        <div className="flex gap-2">
          <input
            readOnly
            value={values.backupDir}
            aria-label="Chosen backup folder"
            placeholder="No folder chosen yet"
            className="min-w-0 flex-1 rounded-md border border-line bg-surface-sunken px-3 py-2 text-fg-muted placeholder:text-fg-subtle"
          />
          <button
            type="button"
            onClick={onPickFolder}
            className="flex shrink-0 items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 font-medium hover:bg-surface-hover"
          >
            <FolderOpen aria-hidden="true" className="size-4" />
            Choose…
          </button>
        </div>

        <div aria-live="polite" className="min-h-5 text-sm">
          {checking && (
            <span className="flex items-center gap-1.5 text-fg-muted">
              <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
              Checking that folder…
            </span>
          )}
          {!checking && check?.ok === true && (
            <span className="flex items-center gap-1.5 text-success">
              <Check aria-hidden="true" className="size-3.5" />
              Looks good
              {check.freeBytes !== undefined && ` — ${gigabytes(check.freeBytes)} free`}
            </span>
          )}
          {!checking && check?.ok === false && (
            <span className="flex items-start gap-1.5 text-danger">
              <AlertTriangle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              <span>
                {check.reason === undefined ? 'That folder cannot be used.' : REASONS[check.reason]}
              </span>
            </span>
          )}
          {!checking && check === undefined && errors.backupDir !== undefined && (
            <span className="text-danger">{errors.backupDir}</span>
          )}
        </div>
      </div>

      <Note icon={HardDrive}>
        Backups are encrypted, so this can be a shared drive, a USB stick or a synced folder. Keep
        it on a different drive from the data folder if you can — a disk that fails takes both
        otherwise.
      </Note>
    </>
  );
}
