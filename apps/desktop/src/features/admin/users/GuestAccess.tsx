import { useId, useState } from 'react';

import { setGuestEnabled } from '../../../api/auth.js';
import { useAuth } from '../../../auth/auth-context.js';
import { useBackendConnection } from '../../../shell/connection-context.js';

/**
 * WP-34 (R134): an institution's lead decides whether anyone who sits down at
 * the club's computer may use it as a guest. Off, the sign-in screen asks for a
 * profile; the guest's work stays where it is.
 */
export function GuestAccess(): React.JSX.Element {
  const connection = useBackendConnection();
  const { me, refresh } = useAuth();
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const enabled = me?.guestEnabled === true;

  return (
    <section
      aria-labelledby={id}
      className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-surface p-4"
    >
      <div>
        <h2 id={id} className="font-medium">
          Guest access
        </h2>
        <p className="text-sm text-fg-muted">
          {enabled
            ? 'Anyone at this computer can use Junction as a guest, without a profile.'
            : 'Only people with a profile can use Junction on this computer.'}
        </p>
        {failure !== undefined && (
          <p role="alert" className="text-sm text-danger">
            {failure}
          </p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label="Allow guests"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setFailure(undefined);
          setGuestEnabled(connection, !enabled)
            .then(refresh)
            .catch((cause: unknown) => {
              setFailure(cause instanceof Error ? cause.message : 'Guest access was not changed.');
            })
            .finally(() => {
              setBusy(false);
            });
        }}
        className="rounded-md border border-line px-3 py-2 hover:bg-surface-hover disabled:opacity-50"
      >
        {enabled ? 'Turn guests off' : 'Allow guests'}
      </button>
    </section>
  );
}
