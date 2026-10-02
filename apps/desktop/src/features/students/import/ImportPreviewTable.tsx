import {
  STUDENT_IMPORT_ACTION_LABELS,
  STUDENT_IMPORT_FIELD_LABELS,
  type StudentImportField,
  type StudentImportPreview,
} from '@compintel/contracts';
import { AlertCircle, CircleCheck, CircleDashed, PencilLine, PlusCircle } from 'lucide-react';
import { useState } from 'react';

import {
  errorsFor,
  errorText,
  filterRows,
  ROWS_PAGE,
  shownFields,
  type RowFilter,
} from './import-model.js';

/**
 * The preview (R93): counts, a filter that jumps to the rows with problems,
 * and each problem written directly under the value it is about. Rows render
 * 200 at a time — a 5 000-row table is unreadable anyway, and the counts say
 * how many there are.
 */

const FILTERS: readonly {
  readonly value: RowFilter;
  readonly label: (counts: StudentImportPreview['counts']) => string;
}[] = [
  { value: 'ALL', label: (counts) => `All rows (${String(counts.total)})` },
  { value: 'ERRORS', label: (counts) => `Rows with errors (${String(counts.error)})` },
  { value: 'CREATE', label: (counts) => `New students (${String(counts.create)})` },
  { value: 'UPDATE', label: (counts) => `Updates (${String(counts.update)})` },
];

function ActionCell({
  row,
}: {
  readonly row: StudentImportPreview['rows'][number];
}): React.JSX.Element {
  if (row.errors.length > 0) {
    return (
      <span className="inline-flex items-center gap-1 text-danger">
        <AlertCircle aria-hidden="true" className="size-4" />
        Not imported
      </span>
    );
  }
  const Icon =
    row.action === 'CREATE' ? PlusCircle : row.action === 'UPDATE' ? PencilLine : CircleDashed;
  return (
    <span className="inline-flex items-center gap-1">
      <Icon aria-hidden="true" className="size-4 text-fg-subtle" />
      {STUDENT_IMPORT_ACTION_LABELS[row.action]}
    </span>
  );
}

export function ImportPreviewTable({
  preview,
}: {
  readonly preview: StudentImportPreview;
}): React.JSX.Element {
  const [filter, setFilter] = useState<RowFilter>(preview.counts.error > 0 ? 'ERRORS' : 'ALL');
  const [shown, setShown] = useState(ROWS_PAGE);
  const fields: StudentImportField[] = shownFields(preview.columns);
  const rows = filterRows(preview.rows, filter);
  const { counts } = preview;

  return (
    <section aria-labelledby="preview-heading" className="flex flex-col gap-3">
      <h2 id="preview-heading" className="text-md">
        What will happen
      </h2>
      <ul className="flex flex-wrap gap-4 text-sm" aria-label="Summary">
        <li className="flex items-center gap-1.5">
          <PlusCircle aria-hidden="true" className="size-4 text-success" />
          {counts.create} new
        </li>
        <li className="flex items-center gap-1.5">
          <PencilLine aria-hidden="true" className="size-4 text-info" />
          {counts.update} updated
        </li>
        <li className="flex items-center gap-1.5">
          <CircleCheck aria-hidden="true" className="size-4 text-fg-subtle" />
          {counts.skip} already up to date
        </li>
        <li className="flex items-center gap-1.5">
          <AlertCircle aria-hidden="true" className="size-4 text-danger" />
          {counts.error} with errors, which will not be imported
        </li>
      </ul>
      <div role="group" aria-label="Show" className="flex flex-wrap gap-2">
        {FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={filter === option.value}
            onClick={() => {
              setFilter(option.value);
              setShown(ROWS_PAGE);
            }}
            className={`rounded-full border px-2.5 py-0.5 text-sm ${
              filter === option.value
                ? 'border-accent bg-accent-surface font-medium'
                : 'border-line text-fg-muted hover:bg-surface-hover'
            }`}
          >
            {option.label(counts)}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-fg-muted">No row of the file is in this group.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-line">
          <table className="w-full border-collapse text-left text-sm">
            <caption className="sr-only">
              Rows of the file and what importing does with each
            </caption>
            <thead className="bg-surface-sunken">
              <tr className="text-fg-subtle">
                <th scope="col" className="px-2 py-1.5 font-medium">
                  Row
                </th>
                <th scope="col" className="px-2 py-1.5 font-medium">
                  Result
                </th>
                {fields.map((field) => (
                  <th key={field} scope="col" className="px-2 py-1.5 font-medium">
                    {STUDENT_IMPORT_FIELD_LABELS[field]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, shown).map((row) => {
                const rowErrors = errorsFor(row, 'row');
                return (
                  <tr
                    key={row.rowNumber}
                    className={`border-t border-line align-top ${row.errors.length > 0 ? 'bg-danger-surface' : ''}`}
                  >
                    <th scope="row" className="px-2 py-1.5 font-mono font-normal text-fg-muted">
                      {row.rowNumber}
                    </th>
                    <td className="px-2 py-1.5">
                      <ActionCell row={row} />
                      {rowErrors.map((error) => (
                        <p key={error.message} className="text-xs text-danger">
                          {errorText(error)}
                        </p>
                      ))}
                      {row.changes.length > 0 && (
                        <p className="text-xs text-fg-muted">
                          {row.changes
                            .map(
                              (change) =>
                                `${STUDENT_IMPORT_FIELD_LABELS[change.field]}: ${change.from || '—'} → ${change.to}`,
                            )
                            .join('; ')}
                        </p>
                      )}
                    </td>
                    {fields.map((field) => (
                      <td key={field} className="max-w-56 px-2 py-1.5 break-words">
                        {row.values[field] ?? ''}
                        {errorsFor(row, field).map((error) => (
                          <p key={error.message} className="text-xs text-danger">
                            {error.message}
                          </p>
                        ))}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > shown && (
        <button
          type="button"
          onClick={() => {
            setShown(shown + ROWS_PAGE);
          }}
          className="mx-auto rounded-md border border-line px-4 py-1.5 hover:bg-surface-hover"
        >
          Show {Math.min(ROWS_PAGE, rows.length - shown)} more of {rows.length - shown}
        </button>
      )}
    </section>
  );
}
