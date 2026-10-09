import type { MyInterestsView } from '@compintel/contracts';
import { X } from 'lucide-react';

import { Dialog } from '../../components/Dialog.js';
import { Guide } from '../../components/Guide.js';
import { Skeleton } from '../../components/Skeleton.js';
import { TagCombobox } from './TagCombobox.js';
import { useInterests } from './use-interests.js';

/**
 * "My interests" (WP-24 step 7, R113, D-18): the categories an event can be
 * filed under, as checkboxes, and any technology, theme or skill as tags.
 * Each change is saved at once and reorders Recommended for you alone.
 */
export function InterestsDialog({ onClose }: { readonly onClose: () => void }): React.JSX.Element {
  const interests = useInterests();
  const view = interests.view;
  const replaceTags = (next: MyInterestsView['tags'], newTagNames: string[] = []): void => {
    if (view === undefined) return;
    void interests
      .replace({
        categoryIds: view.categoryIds,
        tagIds: next.map((tag) => tag.id),
        ...(newTagNames.length === 0 ? {} : { newTagNames }),
      })
      .catch(() => undefined);
  };

  return (
    <Dialog title="My interests" onClose={onClose} width="max-w-lg">
      <div className="flex flex-col gap-4">
        <Guide id="my-interests" title="How interests work">
          <p>
            Recommended puts events that match your interests first, and says so on the card (“AI/ML
            matches your interests”). Interests are yours alone: they change nobody else’s list, and
            nothing is shared or recorded about them.
          </p>
          <p className="mt-1">
            Tick categories, or add any technology, theme or skill. On an event you can also press
            “More like this” beside one of its categories.
          </p>
        </Guide>

        {interests.isPending ? (
          <Skeleton lines={5} label="Loading your interests" />
        ) : view === undefined ? (
          <p role="alert" className="text-sm text-danger">
            Your interests could not be loaded. Close this and try again.
          </p>
        ) : (
          <>
            <fieldset className="flex flex-col gap-1">
              <legend className="mb-1 text-sm font-medium">Categories</legend>
              {view.categoryOptions.length === 0 ? (
                <p className="text-sm text-fg-muted">No categories are set up yet.</p>
              ) : (
                <div className="grid grid-cols-2 gap-1">
                  {view.categoryOptions.map((category) => (
                    <label key={category.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={view.categoryIds.includes(category.id)}
                        onChange={(event) => {
                          void interests
                            .setCategory(category.id, event.target.checked)
                            .catch(() => undefined);
                        }}
                      />
                      {category.name}
                    </label>
                  ))}
                </div>
              )}
            </fieldset>

            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">Tags</p>
              {view.tags.length === 0 ? (
                <p className="text-sm text-fg-muted">None yet.</p>
              ) : (
                <ul aria-label="Your interest tags" className="flex flex-wrap gap-1">
                  {view.tags.map((tag) => (
                    <li
                      key={tag.id}
                      className="flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-sm"
                    >
                      {tag.name}
                      <button
                        type="button"
                        aria-label={`Remove ${tag.name}`}
                        onClick={() => {
                          replaceTags(view.tags.filter((other) => other.id !== tag.id));
                        }}
                        className="rounded-full p-0.5 hover:bg-surface-hover"
                      >
                        <X aria-hidden="true" className="size-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <TagCombobox
                chosen={view.tags}
                onPick={(tag) => {
                  replaceTags([...view.tags, tag]);
                }}
                onCreate={(name) => {
                  replaceTags(view.tags, [name]);
                }}
              />
            </div>
          </>
        )}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:bg-accent-hover"
          >
            Done
          </button>
        </div>
      </div>
    </Dialog>
  );
}
