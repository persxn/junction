import type { ImportField, UrlImportResult } from '@compintel/contracts';
import { useMutation } from '@tanstack/react-query';
import { CalendarPlus, Loader2, PenLine } from 'lucide-react';
import { useState } from 'react';

import { commitImport, createManualEvent, previewImport } from '../../../api/events.js';
import { isApiProblem, type ApiProblem } from '../../../api/problem.js';
import { useToast } from '../../../components/toast/ToastProvider.js';
import { useBackendConnection } from '../../../shell/connection-context.js';
import { EventFields } from './EventFields.js';
import { ImportPanel } from './ImportPanel.js';
import {
  canSave,
  editedOverrides,
  EMPTY_FORM,
  fromPreview,
  hasErrors,
  toManualInput,
  whySaveDisabled,
  type EventFormField,
  type EventFormState,
} from './form-state.js';

/**
 * Add an event, or import one from a link (§10.2, D-30, WP-14 step 8).
 *
 * One form, two ways in. Typing an event in and correcting what a page said are
 * the same act as far as §7.5 is concerned — a person stating a value — so they
 * end in the same boxes and the same Save, and the only difference is where the
 * boxes started from.
 *
 * What the professor changes after an import is tracked, because those fields
 * become `event_overrides` rows and a later scrape may not overwrite them. A
 * value they left exactly as the page had it stays an ordinary source claim, so
 * the source can correct itself later.
 */

type Mode = 'CHOOSE' | 'IMPORT' | 'FORM';

export function CreateEventPage(): React.JSX.Element {
  const connection = useBackendConnection();
  const toast = useToast();

  const [mode, setMode] = useState<Mode>('CHOOSE');
  const [form, setForm] = useState<EventFormState>(EMPTY_FORM);
  const [origins, setOrigins] = useState<ReadonlyMap<EventFormField, ImportField>>(new Map());
  const [uncertain, setUncertain] = useState<ReadonlySet<EventFormField>>(new Set());
  const [edited, setEdited] = useState<ReadonlySet<EventFormField>>(new Set());
  const [imported, setImported] = useState<UrlImportResult | undefined>(undefined);
  const [saved, setSaved] = useState<{ created: boolean; overridden: number } | undefined>(
    undefined,
  );

  const complain = (cause: unknown): void => {
    const problem = cause as ApiProblem;
    toast.show({
      tone: 'danger',
      title: isApiProblem(cause) ? problem.title : 'That did not work',
      description: isApiProblem(cause) ? (problem.detail ?? '') : String(cause),
    });
  };

  const preview = useMutation({
    mutationFn: async (url: string) => previewImport(connection, url),
    onError: complain,
  });

  const save = useMutation({
    mutationFn: async () => {
      const fields = toManualInput(form);
      if (imported === undefined || imported.disposition === 'MANUAL_ONLY') {
        // Nothing was read from a page, so this is the professor's own entry —
        // whether or not a link is attached to it (D-30).
        return createManualEvent(connection, fields);
      }
      return commitImport(connection, {
        url: imported.url,
        disposition: imported.disposition,
        ...(imported.sourceKey === undefined ? {} : { sourceKey: imported.sourceKey }),
        fields,
        edited: editedOverrides(edited),
      });
    },
    onSuccess: (result) => {
      setSaved({ created: result.created, overridden: result.overriddenFields.length });
      toast.show({
        tone: 'success',
        title: result.created ? 'Event added' : 'Added to an event you already had',
        description:
          result.overriddenFields.length === 0
            ? 'It will be kept up to date from its source.'
            : `${String(result.overriddenFields.length)} of your values are pinned, so a later update cannot overwrite them.`,
      });
    },
    onError: complain,
  });

  const change = (field: EventFormField, value: string): void => {
    setForm((current) => ({ ...current, [field]: value }));
    setEdited((current) => new Set(current).add(field));
  };

  const startBlank = (): void => {
    setForm(EMPTY_FORM);
    setOrigins(new Map());
    setUncertain(new Set());
    setEdited(new Set());
    setImported(undefined);
    setSaved(undefined);
    setMode('FORM');
  };

  const useResult = (result: UrlImportResult): void => {
    const filled = fromPreview(result);
    setForm(filled.form);
    setOrigins(filled.origins);
    setUncertain(filled.uncertain);
    setEdited(new Set());
    setImported(result);
    setSaved(undefined);
    setMode('FORM');
  };

  const blocked = whySaveDisabled(form);

  return (
    // A named `section`, not a `main`: AppShell renders the window's one `main`,
    // and a second would be a duplicate landmark.
    <section
      aria-labelledby="create-event-title"
      className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6"
    >
      <header className="flex flex-col gap-1">
        <h1 id="create-event-title" className="text-lg">
          Add an event
        </h1>
        <p className="text-fg-muted">
          Type it in, or paste a link and check what could be read off the page.
        </p>
      </header>

      {mode === 'CHOOSE' && (
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={startBlank}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-2 font-medium text-on-accent hover:bg-accent-hover"
          >
            <PenLine aria-hidden="true" className="size-4" />
            Add event
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('IMPORT');
            }}
            className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-2 font-medium hover:bg-surface-sunken"
          >
            <CalendarPlus aria-hidden="true" className="size-4" />
            Import from a link
          </button>
        </div>
      )}

      {mode === 'IMPORT' && (
        <ImportPanel
          busy={preview.isPending}
          result={preview.data}
          problem={preview.error}
          onPreview={(url) => {
            preview.mutate(url);
          }}
          onUse={useResult}
        />
      )}

      {mode === 'FORM' && (
        <form
          className="flex flex-col gap-6"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          {imported?.disposition === 'MANUAL_ONLY' && (
            <p role="status" className="rounded-lg border border-line bg-surface-sunken px-4 py-3">
              {imported.reason}
            </p>
          )}
          <EventFields
            form={form}
            onChange={change}
            origins={origins}
            uncertain={uncertain}
            disabled={save.isPending}
          />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={!canSave(form) || hasErrors(form) || save.isPending}
              className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-2 font-medium text-on-accent hover:bg-accent-hover disabled:opacity-50"
            >
              {save.isPending && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
              Save event
            </button>
            {blocked !== undefined && <p className="text-fg-muted">{blocked}</p>}
          </div>
          {saved !== undefined && (
            <p role="status" className="rounded-lg border border-line bg-success-subtle px-4 py-3">
              {saved.created
                ? 'Saved as a new event.'
                : 'Saved into an event you already had — nothing was duplicated.'}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
