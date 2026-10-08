import {
  OUTCOME_RESULTS,
  OUTCOME_RESULT_LABELS,
  type OutcomeInput,
  type OutcomeResult,
  type OutcomeView,
} from '@compintel/contracts';
import { useId, useState } from 'react';

import { Dialog } from '../../components/Dialog.js';
import { fromMinor, toMinor } from './outcome-model.js';

/**
 * Recording or editing an outcome (WP-21, R104): the result, rank, prize —
 * text, and an amount in its own currency (R63) — the certificate as a link
 * or path (added as an OUTCOME resource in the same save), a result link,
 * notes and feedback. The server decides; its sentence is shown here.
 */

const FIELD = 'rounded-md border border-line bg-surface px-2 py-1.5 text-sm';

export function OutcomeDialog({
  title,
  current,
  onSubmit,
  onClose,
}: {
  readonly title: string;
  readonly current: OutcomeView | null;
  /** Resolves to a refusal to show, or undefined when saved. */
  readonly onSubmit: (input: OutcomeInput) => Promise<string | undefined>;
  readonly onClose: () => void;
}): React.JSX.Element {
  const id = useId();
  const [result, setResult] = useState<OutcomeResult>(current?.result ?? 'PARTICIPATED');
  const [rank, setRank] = useState(
    current?.rank === null || current === null ? '' : String(current.rank),
  );
  const [prizeText, setPrizeText] = useState(current?.prizeText ?? '');
  const [currency, setCurrency] = useState(current?.prizeCurrency ?? '');
  const [amount, setAmount] = useState(
    fromMinor(current?.prizeMinor ?? null, current?.prizeCurrency ?? null),
  );
  const [certificate, setCertificate] = useState('');
  const [resultUrl, setResultUrl] = useState(current?.resultUrl ?? '');
  const [notes, setNotes] = useState(current?.notes ?? '');
  const [feedback, setFeedback] = useState(current?.feedback ?? '');
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const submit = (): void => {
    const code = currency.trim();
    const minor = toMinor(amount, code === '' ? 'XXX' : code);
    if (minor === undefined) {
      setError('Write the amount as a number, such as 50000 or 49.99.');
      return;
    }
    const rankValue = rank.trim() === '' ? null : Number(rank);
    setBusy(true);
    setError(undefined);
    void onSubmit({
      result,
      rank: rankValue,
      prizeText: prizeText.trim() === '' ? null : prizeText.trim(),
      prizeMinor: minor,
      prizeCurrency: code === '' ? null : code,
      resultUrl: resultUrl.trim() === '' ? null : resultUrl.trim(),
      notes: notes.trim() === '' ? null : notes,
      feedback: feedback.trim() === '' ? null : feedback,
      ...(certificate.trim() === '' ? {} : { certificate: { uri: certificate.trim() } }),
      ...(current === null ? {} : { version: current.version }),
    }).then((refusal) => {
      setBusy(false);
      if (refusal === undefined) onClose();
      else setError(refusal);
    });
  };

  const text = (
    key: string,
    label: string,
    value: string,
    set: (value: string) => void,
    extra: Partial<React.InputHTMLAttributes<HTMLInputElement>> = {},
  ) => (
    <label htmlFor={`${id}-${key}`} className="flex flex-col gap-0.5 text-sm">
      {label}
      <input
        id={`${id}-${key}`}
        value={value}
        onChange={(event) => {
          set(event.target.value);
        }}
        className={FIELD}
        {...extra}
      />
    </label>
  );

  return (
    <Dialog title={title} onClose={onClose} width="max-w-lg">
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label htmlFor={`${id}-result`} className="flex flex-col gap-0.5 text-sm">
          Result
          <select
            id={`${id}-result`}
            value={result}
            onChange={(event) => {
              setResult(event.target.value as OutcomeResult);
            }}
            className={FIELD}
          >
            {OUTCOME_RESULTS.map((value) => (
              <option key={value} value={value}>
                {OUTCOME_RESULT_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        {text('rank', 'Rank (optional)', rank, setRank, { inputMode: 'numeric' })}
        {text('prize', 'Prize (optional)', prizeText, setPrizeText, { maxLength: 200 })}
        <div className="grid grid-cols-[1fr_6rem] gap-2">
          {text('amount', 'Prize amount (optional)', amount, setAmount, { inputMode: 'decimal' })}
          {text(
            'currency',
            'Currency',
            currency,
            (value) => {
              setCurrency(value.toUpperCase());
            },
            { maxLength: 3, placeholder: 'INR' },
          )}
        </div>
        <p className="-mt-2 text-xs text-fg-muted">
          An amount keeps its own currency; CompIntel never converts or adds up currencies.
        </p>
        {text(
          'certificate',
          current?.certificate === null || current === null
            ? 'Certificate — a link or a path (optional)'
            : 'Replace the certificate — a link or a path (optional)',
          certificate,
          setCertificate,
        )}
        {text('link', 'Result announcement link (optional)', resultUrl, setResultUrl, {
          placeholder: 'https://…',
        })}
        <label htmlFor={`${id}-notes`} className="flex flex-col gap-0.5 text-sm">
          Notes (optional)
          <textarea
            id={`${id}-notes`}
            rows={2}
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
            }}
            className={FIELD}
          />
        </label>
        <label htmlFor={`${id}-feedback`} className="flex flex-col gap-0.5 text-sm">
          Feedback from the judges (optional)
          <textarea
            id={`${id}-feedback`}
            rows={2}
            value={feedback}
            onChange={(e) => {
              setFeedback(e.target.value);
            }}
            className={FIELD}
          />
        </label>
        {error !== undefined && (
          <p role="alert" className="rounded-md bg-danger-surface p-2 text-sm">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-surface-hover"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:bg-accent-hover disabled:opacity-50"
          >
            {current === null ? 'Record outcome' : 'Save'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
