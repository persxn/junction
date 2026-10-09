import type { CategoryOrigin, EventCategoryDetail } from '@compintel/contracts';
import { Bot, Plus, ScrollText, Sparkles, Tag, UserPen, X, type LucideIcon } from 'lucide-react';
import { useState } from 'react';

export interface CategoryChipsProps {
  readonly categories: readonly EventCategoryDetail[];
  /** False hides the controls entirely; the chips stay readable (§10.1). */
  readonly canOverride: boolean;
  readonly isSaving: boolean;
  readonly onSave: (categoryIds: readonly string[]) => void;
  /** WP-24: categories already among my interests, and "More like this" (R113). */
  readonly interestIds?: ReadonlySet<string>;
  readonly onMoreLikeThis?: (category: EventCategoryDetail) => void;
}

/** Where a category came from, as icon **and** words (§16.3: never colour alone). */
const ORIGINS: Readonly<Record<CategoryOrigin, { label: string; icon: LucideIcon }>> = {
  SOURCE_TAG: { label: 'from the source’s tag', icon: Tag },
  RULE: { label: 'from a rule', icon: ScrollText },
  MANUAL: { label: 'chosen by a professor', icon: UserPen },
  AI: { label: 'suggested by the assistant', icon: Bot },
};

/**
 * The drawer's category chips and their override (D-15, §10.2 "✓ audited").
 *
 * Each chip says where it came from, because "why is this a Cybersecurity
 * event?" is a fair question and a rule is a different answer from a person.
 * Removing one suppresses it and adding it back clears the suppression — and
 * both survive a re-classification, which is the promise the hint under the
 * chips makes out loud rather than leaving to be discovered.
 */
export function CategoryChips({
  categories,
  canOverride,
  isSaving,
  onSave,
  interestIds,
  onMoreLikeThis,
}: CategoryChipsProps): React.JSX.Element {
  const [adding, setAdding] = useState(false);
  const carried = categories.filter((category) => !category.isSuppressed);
  const suppressed = categories.filter((category) => category.isSuppressed);

  const set = (ids: readonly string[]): void => {
    setAdding(false);
    onSave(ids);
  };

  return (
    <section aria-labelledby="drawer-categories">
      <h3 id="drawer-categories" className="mb-2 text-sm font-medium text-fg-muted">
        Categories
      </h3>
      <ul data-testid="category-chips" className="flex flex-wrap items-center gap-2">
        {carried.length === 0 && (
          <li className="text-sm text-fg-muted">No categories match this event yet.</li>
        )}
        {carried.map((category) => {
          const origin = ORIGINS[category.origin];
          const OriginIcon = origin.icon;
          return (
            <li
              key={category.id}
              className="flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-sm"
            >
              <OriginIcon aria-hidden="true" className="size-3" />
              <span>{category.name}</span>
              <span className="text-xs text-fg-muted">({origin.label})</span>
              {onMoreLikeThis !== undefined &&
                (interestIds?.has(category.id) === true ? (
                  <span className="flex items-center gap-0.5 text-xs text-accent">
                    <Sparkles aria-hidden="true" className="size-3" />
                    One of your interests
                  </span>
                ) : (
                  <button
                    type="button"
                    aria-label={`More like this: add ${category.name} to your interests`}
                    onClick={() => {
                      onMoreLikeThis(category);
                    }}
                    className="flex items-center gap-0.5 rounded-full px-1 text-xs text-accent hover:bg-surface-hover"
                  >
                    <Sparkles aria-hidden="true" className="size-3" />
                    More like this
                  </button>
                ))}
              {canOverride && (
                <button
                  type="button"
                  disabled={isSaving}
                  aria-label={`Remove ${category.name}`}
                  onClick={() => {
                    set(carried.filter((row) => row.id !== category.id).map((row) => row.id));
                  }}
                  className="rounded-full p-0.5 hover:bg-surface-hover disabled:opacity-60"
                >
                  <X aria-hidden="true" className="size-3" />
                </button>
              )}
            </li>
          );
        })}
        {canOverride && suppressed.length > 0 && (
          <li>
            <button
              type="button"
              aria-expanded={adding}
              onClick={() => {
                setAdding((value) => !value);
              }}
              className="flex items-center gap-1 rounded-full border border-dashed border-line px-2 py-0.5 text-sm hover:bg-surface-hover"
            >
              <Plus aria-hidden="true" className="size-3" />
              Add back
            </button>
          </li>
        )}
      </ul>

      {adding && (
        <ul className="mt-2 flex flex-wrap gap-2">
          {suppressed.map((category) => (
            <li key={category.id}>
              <button
                type="button"
                disabled={isSaving}
                onClick={() => {
                  set([...carried.map((row) => row.id), category.id]);
                }}
                className="rounded-full border border-line px-2 py-0.5 text-sm hover:bg-surface-hover disabled:opacity-60"
              >
                {category.name}
              </button>
            </li>
          ))}
        </ul>
      )}

      {canOverride && (
        <p className="mt-2 text-xs text-fg-muted">
          Your choices survive re-classification: a rule change never undoes them.
        </p>
      )}
    </section>
  );
}
