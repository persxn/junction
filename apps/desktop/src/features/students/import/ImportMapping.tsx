import {
  STUDENT_IMPORT_FIELDS,
  STUDENT_IMPORT_FIELD_LABELS,
  type StudentImportColumn,
  type StudentImportField,
  type StudentImportFieldError,
} from '@compintel/contracts';
import { AlertTriangle, RefreshCw } from 'lucide-react';

import { errorText } from './import-model.js';

/**
 * The mapping step: one line per column of the file, with what it feeds. A
 * recognised heading shows its match ("recognised"); an unknown one starts as
 * "Not imported". Changing any of them and pressing "Check again" re-reads the
 * file with the new mapping.
 */

export interface ImportMappingProps {
  readonly columns: readonly StudentImportColumn[];
  readonly errors: readonly StudentImportFieldError[];
  readonly dirty: boolean;
  readonly busy: boolean;
  readonly onChange: (index: number, field: StudentImportField | null) => void;
  readonly onApply: () => void;
}

export function ImportMapping(props: ImportMappingProps): React.JSX.Element {
  return (
    <section aria-labelledby="mapping-heading" className="flex flex-col gap-3">
      <h2 id="mapping-heading" className="text-md">
        Columns in the file
      </h2>
      {props.errors.length > 0 && (
        <ul
          role="alert"
          className="flex flex-col gap-1 rounded-md bg-danger-surface p-3 text-sm text-danger"
        >
          {props.errors.map((error) => (
            <li key={`${error.field}:${error.message}`} className="flex items-start gap-2">
              <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {errorText(error)}
            </li>
          ))}
        </ul>
      )}
      <table className="w-full max-w-2xl border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-line text-fg-subtle">
            <th scope="col" className="py-1.5 pr-3 font-medium">
              Heading in the file
            </th>
            <th scope="col" className="py-1.5 font-medium">
              Imported as
            </th>
          </tr>
        </thead>
        <tbody>
          {props.columns.map((column) => (
            <tr key={column.index} className="border-b border-line">
              <th scope="row" className="py-1.5 pr-3 font-normal">
                {column.header === '' ? (
                  <span className="text-fg-subtle">(no heading)</span>
                ) : (
                  column.header
                )}
              </th>
              <td className="py-1.5">
                <label className="sr-only" htmlFor={`map-${String(column.index)}`}>
                  Import “{column.header}” as
                </label>
                <select
                  id={`map-${String(column.index)}`}
                  value={column.field ?? ''}
                  onChange={(event) => {
                    props.onChange(
                      column.index,
                      event.target.value === '' ? null : (event.target.value as StudentImportField),
                    );
                  }}
                  className="rounded-md border border-line bg-surface px-2 py-1"
                >
                  <option value="">Not imported</option>
                  {STUDENT_IMPORT_FIELDS.map((field) => (
                    <option key={field} value={field}>
                      {STUDENT_IMPORT_FIELD_LABELS[field]}
                    </option>
                  ))}
                </select>
                {column.guessed && column.field !== null && (
                  <span className="ml-2 text-xs text-fg-subtle">recognised</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {props.dirty && (
        <button
          type="button"
          onClick={props.onApply}
          disabled={props.busy}
          className="flex w-fit items-center gap-2 rounded-md bg-accent px-3 py-1.5 font-medium text-on-accent hover:bg-accent-hover disabled:opacity-60"
        >
          <RefreshCw aria-hidden="true" className={`size-4 ${props.busy ? 'animate-spin' : ''}`} />
          Check again with these columns
        </button>
      )}
    </section>
  );
}
