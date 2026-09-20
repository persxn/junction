import { Check, Copy, KeyRound, X } from 'lucide-react';
import { useState } from 'react';

/**
 * A password that exists once (§4.12).
 *
 * The server generated it, put it in one response and kept only a hash. If this
 * panel is dismissed before anybody writes it down, the only way forward is
 * another reset — which is a better failure than a password that can be fetched
 * again by whoever opens this screen next.
 */
export function OneTimePassword({
  email,
  password,
  onDismiss,
}: {
  readonly email: string;
  readonly password: string;
  readonly onDismiss: () => void;
}): React.JSX.Element {
  const [copied, setCopied] = useState(false);

  return (
    <section
      aria-label="One-time password"
      className="flex flex-col gap-2 rounded-md border-l-4 border-accent bg-accent-surface p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="flex items-center gap-2 font-medium">
          <KeyRound aria-hidden="true" className="size-4" />
          One-time password for {email}
        </p>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss the one-time password"
          className="rounded-sm p-1 hover:bg-surface-hover"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>
      <p className="text-sm text-fg-muted">
        Give it to them in person or over something they already trust. They will have to choose
        their own password the first time they sign in. It is not shown again.
      </p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-2 font-mono break-all select-all">
          {password}
        </code>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(password).then(
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
    </section>
  );
}
