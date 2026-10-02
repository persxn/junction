import type {
  StudentImportColumn,
  StudentImportCommitResult,
  StudentImportField,
  StudentImportPreview,
} from '@compintel/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, CheckCircle2, FileSpreadsheet, FileUp, Loader2 } from 'lucide-react';
import { useState } from 'react';

import { isApiProblem } from '../../../api/problem.js';
import { commitImport, previewImport } from '../../../api/students.js';
import { useBackendConnection } from '../../../shell/connection-context.js';
import { pickImportFile, PickedFileError, type PickedFile } from '../../../shell/files.js';
import { ImportGuide } from './ImportGuide.js';
import { ImportMapping } from './ImportMapping.js';
import { canCommit, mappingOf, minutesLeft, withField } from './import-model.js';
import { ImportPreviewTable } from './ImportPreviewTable.js';

/**
 * "Import a list" (WP-17 step 5–6, R93): choose a file → check the columns →
 * read the preview → import → the result. Nothing is written before Import,
 * and Import applies the preview the server holds, not the file again.
 */

const problemText = (error: unknown): string =>
  isApiProblem(error)
    ? error.status === 410
      ? 'This preview is more than 30 minutes old and was forgotten. Choose the file again.'
      : (error.detail ?? error.title)
    : error instanceof PickedFileError
      ? error.message
      : 'The local service did not answer.';

function Result({
  result,
  onAgain,
}: {
  readonly result: StudentImportCommitResult;
  readonly onAgain: () => void;
}): React.JSX.Element {
  return (
    <section aria-labelledby="result-heading" className="flex flex-col gap-3">
      <h2 id="result-heading" className="flex items-center gap-2 text-md">
        <CheckCircle2 aria-hidden="true" className="size-5 text-success" />
        Import finished
      </h2>
      <ul className="flex flex-col gap-1 text-sm">
        <li>{result.created} new students added</li>
        <li>{result.updated} students updated</li>
        <li>{result.skipped} already up to date</li>
        <li>{result.failed} rows with errors were not imported</li>
      </ul>
      {result.stale.length > 0 && (
        <div role="status" className="rounded-md bg-warning-surface p-3 text-sm">
          <p className="font-medium">
            {result.stale.length} rows were left alone because those students changed after the
            preview:
          </p>
          <ul className="mt-1 list-disc pl-5">
            {result.stale.map((row) => (
              <li key={row.rowNumber}>
                Row {row.rowNumber}: {row.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex gap-2">
        <Link
          to="/students"
          className="rounded-md bg-accent px-3 py-1.5 font-medium text-on-accent hover:bg-accent-hover"
        >
          See the students
        </Link>
        <button
          type="button"
          onClick={onAgain}
          className="rounded-md border border-line px-3 py-1.5 hover:bg-surface-hover"
        >
          Import another file
        </button>
      </div>
    </section>
  );
}

export function ImportPage(): React.JSX.Element {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [file, setFile] = useState<PickedFile | undefined>(undefined);
  const [preview, setPreview] = useState<StudentImportPreview | undefined>(undefined);
  const [columns, setColumns] = useState<readonly StudentImportColumn[]>([]);
  const [dirty, setDirty] = useState(false);
  const [mentorMe, setMentorMe] = useState(true);
  const [privacy, setPrivacy] = useState(false);
  const [result, setResult] = useState<StudentImportCommitResult | undefined>(undefined);
  const [pickError, setPickError] = useState<string | undefined>(undefined);
  // Worked out when the preview arrives, not while rendering (render stays pure).
  const [keptFor, setKeptFor] = useState('');
  const connection = useBackendConnection();

  const check = useMutation({
    mutationFn: (input: { picked: PickedFile; withMapping: boolean }) =>
      previewImport(connection, {
        fileName: input.picked.name,
        base64: input.picked.base64,
        ...(input.withMapping ? { mapping: mappingOf(columns) } : {}),
      }),
    onSuccess: (next) => {
      setPreview(next);
      setKeptFor(minutesLeft(next.expiresAt, Date.now()));
      setColumns(next.columns);
      setDirty(false);
    },
  });
  const commit = useMutation({
    mutationFn: (previewId: string) =>
      commitImport(connection, { previewId, mentorMe, privacyNoticeShown: privacy }),
    onSuccess: (done) => {
      setResult(done);
      void client.invalidateQueries({ queryKey: ['students'] });
    },
  });

  const choose = async (): Promise<void> => {
    setPickError(undefined);
    try {
      const picked = await pickImportFile();
      if (picked === undefined) return;
      setFile(picked);
      setPreview(undefined);
      check.mutate({ picked, withMapping: false });
    } catch (cause) {
      setPickError(problemText(cause));
    }
  };
  const restart = (): void => {
    setFile(undefined);
    setPreview(undefined);
    setResult(undefined);
    setPrivacy(false);
    check.reset();
    commit.reset();
  };

  const applicable = preview === undefined ? 0 : preview.counts.create + preview.counts.update;
  const ready =
    preview !== undefined &&
    !dirty &&
    canCommit({
      mappingErrors: preview.mappingErrors.length,
      applicable,
      privacyNoticeShown: privacy,
      creates: preview.counts.create,
    });

  return (
    <section aria-labelledby="import-heading" className="flex flex-col gap-5">
      <Link
        to="/students"
        className="flex w-fit items-center gap-1 text-sm text-fg-muted hover:text-fg"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        All students
      </Link>
      <h1 id="import-heading" className="font-display text-xl">
        Import students from a spreadsheet
      </h1>
      <ImportGuide />

      {result !== undefined ? (
        <Result result={result} onAgain={restart} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void choose()}
              disabled={check.isPending || commit.isPending}
              className="flex items-center gap-2 rounded-md bg-accent px-3 py-2 font-medium text-on-accent hover:bg-accent-hover disabled:opacity-60"
            >
              <FileUp aria-hidden="true" className="size-4" />
              {file === undefined ? 'Choose a file…' : 'Choose a different file…'}
            </button>
            {file !== undefined && (
              <span className="flex items-center gap-1.5 text-sm text-fg-muted">
                <FileSpreadsheet aria-hidden="true" className="size-4" />
                {file.name}
              </span>
            )}
            {check.isPending && (
              <span role="status" className="flex items-center gap-1.5 text-sm text-fg-muted">
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                Reading and checking every row…
              </span>
            )}
          </div>
          {(pickError !== undefined || check.isError) && (
            <p role="alert" className="rounded-md bg-danger-surface p-3 text-sm text-danger">
              {pickError ?? problemText(check.error)}
            </p>
          )}

          {preview !== undefined && file !== undefined && (
            <>
              <ImportMapping
                columns={columns}
                errors={preview.mappingErrors}
                dirty={dirty}
                busy={check.isPending}
                onChange={(index: number, field: StudentImportField | null) => {
                  setColumns(withField(columns, index, field));
                  setDirty(true);
                }}
                onApply={() => {
                  check.mutate({ picked: file, withMapping: true });
                }}
              />
              {!dirty && <ImportPreviewTable key={preview.previewId} preview={preview} />}
              {!dirty && (
                <section
                  aria-labelledby="commit-heading"
                  className="flex flex-col gap-3 rounded-lg border border-line p-4"
                >
                  <h2 id="commit-heading" className="text-md">
                    Import
                  </h2>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={mentorMe}
                      onChange={(event) => {
                        setMentorMe(event.target.checked);
                      }}
                    />
                    I mentor the new students in this file
                  </label>
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={privacy}
                      onChange={(event) => {
                        setPrivacy(event.target.checked);
                      }}
                    />
                    <span>
                      The new students have been shown the privacy notice
                      {preview.counts.create > 0 && (
                        <span className="block text-sm text-fg-subtle">
                          Needed before new students can be added.
                        </span>
                      )}
                    </span>
                  </label>
                  {commit.isError && (
                    <p role="alert" className="text-sm text-danger">
                      {problemText(commit.error)}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      disabled={!ready || commit.isPending}
                      onClick={() => {
                        commit.mutate(preview.previewId);
                      }}
                      className="rounded-md bg-accent px-4 py-2 font-medium text-on-accent hover:bg-accent-hover disabled:opacity-50"
                    >
                      {commit.isPending
                        ? 'Importing…'
                        : `Import ${String(applicable)} ${applicable === 1 ? 'row' : 'rows'}`}
                    </button>
                    <button
                      type="button"
                      onClick={() => void navigate({ to: '/students' })}
                      className="rounded-md px-3 py-2 hover:bg-surface-hover"
                    >
                      Cancel
                    </button>
                    <span className="text-sm text-fg-subtle">
                      This check is kept for {keptFor}.
                    </span>
                  </div>
                </section>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
