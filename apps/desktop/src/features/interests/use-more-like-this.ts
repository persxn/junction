import { useMemo } from 'react';

import { useToast } from '../../components/toast/ToastProvider.js';
import { useInterests } from './use-interests.js';

/**
 * The drawer's "More like this" (WP-24 step 7): adds a category to my
 * interests with an Undo toast. Recommended reorders at once (the RELEVANCE
 * lists are invalidated by `useInterests`).
 */
export function useMoreLikeThis(): {
  readonly interestIds: ReadonlySet<string>;
  readonly add: (category: { readonly id: string; readonly name: string }) => void;
} {
  const interests = useInterests();
  const toast = useToast();
  const ids = interests.view?.categoryIds;
  const interestIds = useMemo(() => new Set(ids ?? []), [ids]);
  return {
    interestIds,
    add: (category) => {
      interests.setCategory(category.id, true).then(
        () => {
          toast.show({
            tone: 'success',
            title: `Added ${category.name} to your interests`,
            description: 'Recommended now puts events like this first.',
            action: {
              label: 'Undo',
              onAction: () => {
                void interests.setCategory(category.id, false).catch(() => undefined);
              },
            },
          });
        },
        () => undefined,
      );
    },
  };
}
