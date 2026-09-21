import type { UrlImportResult } from '@compintel/contracts';
import { Link2, Loader2, Search } from 'lucide-react';
import { useId, useState } from 'react';

import { isApiProblem, type ApiProblem } from '../../../api/problem.js';

/**
 * "Import from a link": paste a URL, see what could be read, then review it in
 * the form (§7.1's URL-import bullet, D-30, WP-14 step 8).
 *
 * Three things this screen refuses to do. It never saves anything — the preview
 * writes nothing, and the professor presses Save on the form afterwards. It
 * never shows only what was found: the list of what was *not* found is beside
 * it, because a short list of values invites the reader to assume the rest is
 * absent from the event rather than from the page. And a domain we do not read
 * automatically is not an error here — it is its own state, with the reason in
 * the source's own words and the link already attached to the form.
 */

export interface ImportPanelProps {
  readonly onPreview: (url: string) => void;
  readonly onUse: (result: UrlImportResult) => void;
  readonly result: UrlImportResult | undefined;
  readonly problem: unknown;
  readonly busy: boolean;
}

/** What each refusal means, in terms a professor can act on (R5's `code`). */
const REFUSAL: Readonly<Record<string, string>> = {
  IMPORT_URL_INVALID: 'That is not a link this can read.',
  IMPORT_ROBOTS_DISALLOWED: 'That site asks not to be read automatically.',
  IMPORT_UNSUPPORTED_CONTENT: 'That link is a file, not a web page.',
  IMPORT_EXTRACTION_FAILED: 'That page has no event details this could recognise.',
  IMPORT_TOO_LARGE: 'That page is too large to read.',
  IMPORT_RATE_LIMITED: 'That is a lot of links at once.',
  SOURCE_UNREACHABLE: 'That page could not be reached.',
};

function Problem({ problem }: { readonly problem: unknown }): React.JSX.Element {
  const details = problem as ApiProblem;
  const known = isApiProblem(problem) ? REFUSAL[details.code] : undefined;
  return (
    <div
      role="alert"
      className="flex flex-col gap-1 rounded-lg border border-danger bg-danger-subtle px-4 py-3"
    >
      <p className="font-medium">
        {known ?? (isApiProblem(problem) ? details.title : 'That did not work')}
      </p>
      {isApiProblem(problem) && details.detail !== undefined && (
        <p className="text-fg-muted">{details.detail}</p>
      )}
      <p className="text-fg-muted">
        {isApiProblem(problem) && details.hint !== undefined
          ? details.hint
          : 'Type the details in — the link is kept with the event.'}
      </p>
    </div>
  );
}

function ManualOnly({ result }: { readonly result: UrlImportResult }): React.JSX.Element {
  return (
    <div
      role="status"
      className="flex flex-col gap-2 rounded-lg border border-line bg-surface-sunken px-4 py-3"
    >
      <p className="font-medium">{result.sourceName ?? 'That site'} is not read automatically</p>
      <p className="text-fg-muted">{result.reason}</p>
      <p className="text-fg-muted">
        Nothing was requested from it — not the page, and not even its robots file.
      </p>
    </div>
  );
}

function Found({ result }: { readonly result: UrlImportResult }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface-raised px-4 py-3">
      <p className="font-medium">
        {result.fieldsFound.length} of {result.fieldsFound.length + result.fieldsMissing.length}{' '}
        details were found
        {result.sourceName === undefined ? '' : ` on ${result.sourceName}`}
      </p>
      <ul className="flex flex-col gap-1">
        {result.fieldsFound.map((field) => (
          <li key={field.field} className="flex flex-wrap items-baseline gap-2">
            <span className="text-fg-muted">{field.label}:</span>
            <span>{field.value}</span>
            {field.confidence < 0.8 && (
              <span className="rounded-full bg-warning-subtle px-2 py-0.5 text-sm text-warning-strong">
                worth checking
              </span>
            )}
          </li>
        ))}
      </ul>
      {result.fieldsMissing.length > 0 && (
        <p className="text-fg-muted">
          Not found: {result.fieldsMissing.join(', ')}. Fill in whatever you know.
        </p>
      )}
      {result.warnings.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm text-fg-muted">
          {result.warnings.map((warning) => (
            <li key={`${warning.code}-${warning.field ?? ''}`}>{warning.message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ImportPanel({
  onPreview,
  onUse,
  result,
  problem,
  busy,
}: ImportPanelProps): React.JSX.Element {
  const id = useId();
  const [url, setUrl] = useState('');

  return (
    <section className="flex flex-col gap-4" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} className="text-md">
        Import from a link
      </h2>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          onPreview(url.trim());
        }}
      >
        <div className="flex min-w-64 flex-1 flex-col gap-1.5">
          <label htmlFor={`${id}-url`} className="font-medium">
            Event page
          </label>
          <input
            id={`${id}-url`}
            type="url"
            value={url}
            placeholder="https://…"
            onChange={(event) => {
              setUrl(event.target.value);
            }}
            className="rounded-md border border-line bg-surface px-3 py-2 text-fg placeholder:text-fg-subtle focus:border-accent"
          />
        </div>
        <button
          type="submit"
          disabled={busy || url.trim().length === 0}
          className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-2 font-medium text-on-accent hover:bg-accent-hover disabled:opacity-50"
        >
          {busy ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <Search aria-hidden="true" className="size-4" />
          )}
          Read the page
        </button>
      </form>

      {problem !== undefined && problem !== null && <Problem problem={problem} />}

      {result?.disposition === 'MANUAL_ONLY' && <ManualOnly result={result} />}
      {result !== undefined && result.disposition !== 'MANUAL_ONLY' && <Found result={result} />}

      {result !== undefined && (
        <button
          type="button"
          onClick={() => {
            onUse(result);
          }}
          className="inline-flex w-fit items-center gap-2 rounded-md border border-line px-3 py-2 font-medium hover:bg-surface-sunken"
        >
          <Link2 aria-hidden="true" className="size-4" />
          {result.disposition === 'MANUAL_ONLY'
            ? 'Type the details in, with this link'
            : 'Review these details'}
        </button>
      )}
    </section>
  );
}
