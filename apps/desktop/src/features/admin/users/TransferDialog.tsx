import type {
  TransferItem,
  TransferPreview,
  TransferResult,
  UserSummary,
} from '@compintel/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft } from 'lucide-react';
import { useId, useState } from 'react';

import { isApiProblem } from '../../../api/problem.js';
import { commitTransfer, previewTransfer } from '../../../api/transfer.js';
import { Dialog } from '../../../components/Dialog.js';
import { Guide } from '../../../components/Guide.js';
import { useBackendConnection } from '../../../shell/connection-context.js';
import { problemText } from '../../competitions/use-competition-actions.js';

/**
 * Admin → Users → Transfer ownership… (§10.4, R105, WP-21): pick from and to,
 * read the preview in its four groups with counts and before → after
 * sentences, Confirm, see the summary. An empty preview cannot be confirmed;
 * "Something changed since the preview" reloads it.
 */

const FIELD = 'rounded-md border border-line bg-surface px-2 py-1.5 text-sm';
export const STALE_PREVIEW_TEXT = 'Something changed since the preview — review it again.';

function Group({
  title,
  items,
}: {
  readonly title: string;
  readonly items: readonly TransferItem[];
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-1">
      <h3 className="text-sm font-medium">
        {title} ({items.length})
      </h3>
      {items.length === 0 ? (
        <p className="text-xs text-fg-muted">None.</p>
      ) : (
        <ul className="flex max-h-40 flex-col gap-0.5 overflow-y-auto text-sm">
          {items.map((item) => (
            <li key={`${item.kind}-${item.entityId}`}>
              <span className="font-medium">{item.name}</span>
              <span className="text-fg-muted"> — {item.sentence}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function TransferDialog({
  users,
  onClose,
}: {
  readonly users: readonly UserSummary[];
  readonly onClose: () => void;
}): React.JSX.Element {
  const id = useId();
  const connection = useBackendConnection();
  const client = useQueryClient();
  const professors = users.filter((user) => user.roles.includes('PROFESSOR'));
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [preview, setPreview] = useState<TransferPreview | undefined>(undefined);
  const [result, setResult] = useState<TransferResult | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const load = async (fromUserId: string, toUserId: string): Promise<void> => {
    setBusy(true);
    try {
      setPreview(await previewTransfer(connection, { fromUserId, toUserId }));
    } catch (cause) {
      setPreview(undefined);
      setNotice(problemText(cause));
    }
    setBusy(false);
  };

  const confirm = async (current: TransferPreview): Promise<void> => {
    setBusy(true);
    try {
      setResult(
        await commitTransfer(connection, {
          fromUserId: current.from.userId,
          toUserId: current.to.userId,
          previewToken: current.previewToken,
        }),
      );
      void client.invalidateQueries();
    } catch (cause) {
      if (isApiProblem(cause) && cause.code === 'TRANSFER_PREVIEW_STALE') {
        setNotice(STALE_PREVIEW_TEXT);
        await load(current.from.userId, current.to.userId);
        return;
      }
      setNotice(problemText(cause));
    }
    setBusy(false);
  };

  const empty =
    preview !== undefined &&
    preview.teams.length + preview.competitions.length + preview.mentorships.length === 0;

  return (
    <Dialog title="Transfer ownership" onClose={onClose} width="max-w-2xl">
      {result !== undefined ? (
        <div className="flex flex-col gap-3 text-sm">
          <p role="status">
            Moved {result.teams} {result.teams === 1 ? 'team' : 'teams'}, {result.competitions}{' '}
            {result.competitions === 1 ? 'competition' : 'competitions'} and {result.mentorships}{' '}
            {result.mentorships === 1 ? 'mentorship' : 'mentorships'}. History, outcomes and the
            audit log are unchanged; {result.auditRows} audit entries record the move.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="w-fit rounded-md border border-line px-3 py-1.5 hover:bg-surface-hover"
          >
            Close
          </button>
        </div>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            setNotice(undefined);
            void load(from, to);
          }}
        >
          <Guide id="ownership-transfer" title="What a transfer moves">
            <p>
              Everything the first professor <strong>actively</strong> mentors — active teams, open
              competitions and students — moves to the second, at one moment. Archived teams and
              finished competitions stay with the first professor as history. Workflow templates
              stay with their author.
            </p>
          </Guide>
          <div className="grid gap-3 sm:grid-cols-2">
            <label htmlFor={`${id}-from`} className="flex flex-col gap-0.5 text-sm">
              From
              <select
                id={`${id}-from`}
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  setPreview(undefined);
                }}
                className={FIELD}
              >
                <option value="">Choose a professor</option>
                {professors.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.displayName}
                    {user.status === 'ACTIVE' ? '' : ' (disabled)'}
                  </option>
                ))}
              </select>
            </label>
            <label htmlFor={`${id}-to`} className="flex flex-col gap-0.5 text-sm">
              To
              <select
                id={`${id}-to`}
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  setPreview(undefined);
                }}
                className={FIELD}
              >
                <option value="">Choose a professor</option>
                {professors
                  .filter((user) => user.status === 'ACTIVE' && user.id !== from)
                  .map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.displayName}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <button
            type="submit"
            disabled={busy || from === '' || to === ''}
            className="flex w-fit items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm hover:bg-surface-hover disabled:opacity-50"
          >
            Preview
          </button>
          {notice !== undefined && (
            <p role="alert" className="rounded-md bg-warning-surface p-2 text-sm">
              {notice}
            </p>
          )}
          {preview !== undefined && (
            <div className="flex flex-col gap-3 rounded-md border border-line p-3">
              <p className="text-sm">
                From <strong>{preview.from.displayName}</strong> to{' '}
                <strong>{preview.to.displayName}</strong>
              </p>
              <Group title="Teams" items={preview.teams} />
              <Group title="Competitions" items={preview.competitions} />
              <Group title="Mentorships" items={preview.mentorships} />
              <Group title="Stays as history" items={preview.staysWith} />
              {empty && (
                <p className="text-sm text-fg-muted">
                  Nothing to move — this professor has no active teams, open competitions or
                  mentorships.
                </p>
              )}
              <button
                type="button"
                disabled={busy || empty}
                onClick={() => {
                  setNotice(undefined);
                  void confirm(preview);
                }}
                className="flex w-fit items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:bg-accent-hover disabled:opacity-50"
              >
                <ArrowRightLeft aria-hidden="true" className="size-4" />
                Confirm transfer
              </button>
            </div>
          )}
        </form>
      )}
    </Dialog>
  );
}
