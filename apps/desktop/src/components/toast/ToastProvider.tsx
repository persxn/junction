import { AlertTriangle, CheckCircle2, Info, OctagonAlert, X, type LucideIcon } from 'lucide-react';
import { createContext, use, useCallback, useMemo, useRef, useState } from 'react';

/**
 * Transient feedback (§16.3: "optimistic updates with Undo for reversible
 * actions"). One provider owns the queue and one polite live region announces
 * it, so a screen reader hears each message once, in order, without the focus
 * being stolen from whatever the user was doing.
 */

export type ToastTone = 'info' | 'success' | 'warning' | 'danger';

export interface ToastAction {
  readonly label: string;
  readonly onAction: () => void;
}

export interface ToastOptions {
  readonly title: string;
  readonly description?: string;
  readonly tone?: ToastTone;
  /** 0 keeps it up until the user dismisses it. */
  readonly durationMs?: number;
  /**
   * The Undo slot. WP-06 ships the mechanism; the reversible actions that use it
   * (hide an event, unassign a team) arrive with their own work packages.
   */
  readonly action?: ToastAction;
}

interface Toast extends ToastOptions {
  readonly id: string;
}

export interface ToastApi {
  /** Queues a toast and returns its id, so the caller can dismiss it early. */
  readonly show: (options: ToastOptions) => string;
  readonly dismiss: (id: string) => void;
}

const DEFAULT_DURATION_MS = 6_000;
/** A toast the user is expected to act on stays long enough to be acted on. */
const ACTIONABLE_DURATION_MS = 10_000;

const TONE_ICONS: Record<ToastTone, LucideIcon> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: OctagonAlert,
};

/** §16.3: never colour alone — the tone is also a word and an icon. */
const TONE_LABELS: Record<ToastTone, string> = {
  info: 'Information',
  success: 'Success',
  warning: 'Warning',
  danger: 'Error',
};

const TONE_CLASSES: Record<ToastTone, string> = {
  info: 'border-info text-info',
  success: 'border-success text-success',
  warning: 'border-warning text-warning',
  danger: 'border-danger text-danger',
};

const ToastContext = createContext<ToastApi | undefined>(undefined);

export function ToastProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [toasts, setToasts] = useState<readonly Toast[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (options: ToastOptions): string => {
      nextId.current += 1;
      const id = `toast-${String(nextId.current)}`;
      setToasts((current) => [...current, { ...options, id }]);
      const duration =
        options.durationMs ??
        (options.action === undefined ? DEFAULT_DURATION_MS : ACTIONABLE_DURATION_MS);
      if (duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => {
            dismiss(id);
          }, duration),
        );
      }
      return id;
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext value={api}>
      {children}
      <ToastRegion toasts={toasts} onDismiss={dismiss} />
    </ToastContext>
  );
}

function ToastRegion({
  toasts,
  onDismiss,
}: {
  readonly toasts: readonly Toast[];
  readonly onDismiss: (id: string) => void;
}): React.JSX.Element {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Notifications"
      className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-80 flex-col gap-2"
    >
      {toasts.map((toast) => {
        const tone = toast.tone ?? 'info';
        const Icon = TONE_ICONS[tone];
        return (
          <div
            key={toast.id}
            className={`pointer-events-auto flex gap-2 rounded-md border-l-4 bg-surface-raised p-3 shadow-[var(--ci-shadow-popover)] ${TONE_CLASSES[tone]}`}
          >
            <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <div className="min-w-0 flex-1 text-fg">
              <p className="font-medium">
                <span className="sr-only">{TONE_LABELS[tone]}: </span>
                {toast.title}
              </p>
              {toast.description !== undefined && (
                <p className="text-sm text-fg-muted">{toast.description}</p>
              )}
              {toast.action !== undefined && (
                <button
                  type="button"
                  className="mt-1 font-medium text-accent underline"
                  onClick={() => {
                    toast.action?.onAction();
                    onDismiss(toast.id);
                  }}
                >
                  {toast.action.label}
                </button>
              )}
            </div>
            <button
              type="button"
              aria-label={`Dismiss: ${toast.title}`}
              className="h-fit rounded-sm p-0.5 text-fg-muted hover:bg-surface-hover"
              onClick={() => {
                onDismiss(toast.id);
              }}
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function useToast(): ToastApi {
  const api = use(ToastContext);
  if (api === undefined) {
    throw new Error('useToast() needs a <ToastProvider> above it');
  }
  return api;
}
