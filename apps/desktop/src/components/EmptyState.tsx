import type { LucideIcon } from 'lucide-react';

export interface EmptyStateAction {
  readonly label: string;
  readonly onAction: () => void;
}

export interface EmptyStateProps {
  readonly icon?: LucideIcon;
  readonly title: string;
  /** Why it is empty, in the user's terms — not "no rows returned". */
  readonly description: string;
  /**
   * Required on purpose (§16.3: "empty states that suggest the next action"). An
   * empty state with nothing to do is a dead end, so the type will not let one be
   * written.
   */
  readonly action: EmptyStateAction;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: EmptyStateProps): React.JSX.Element {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-lg border border-line bg-surface-raised px-6 py-10 text-center">
      {Icon !== undefined && <Icon aria-hidden="true" className="size-6 text-fg-subtle" />}
      <h2 className="text-md">{title}</h2>
      <p className="text-fg-muted">{description}</p>
      <button
        type="button"
        onClick={action.onAction}
        className="rounded-md bg-accent px-3 py-1.5 font-medium text-on-accent hover:bg-accent-hover"
      >
        {action.label}
      </button>
    </div>
  );
}
