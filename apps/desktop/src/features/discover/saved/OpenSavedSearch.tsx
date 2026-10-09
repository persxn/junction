import { useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';

import { useToast } from '../../../components/toast/ToastProvider.js';
import { filtersOfSaved } from '../query.js';
import { useSavedSearches } from './use-saved-searches.js';

/**
 * `/discover/saved/$savedSearchId` (WP-24): where a NEW_MATCH notification
 * points (notification routes are plain paths, with no query string). It sits
 * over Discover, applies the search — its filters back on the chips, on All
 * events — and replaces itself in history. A search deleted since says so.
 */
export function OpenSavedSearch(): React.JSX.Element | null {
  const { savedSearchId } = useParams({ from: '/discover/saved/$savedSearchId' });
  const navigate = useNavigate();
  const toast = useToast();
  const searches = useSavedSearches();
  const done = useRef(false);

  useEffect(() => {
    if (done.current || searches.isPending) return;
    done.current = true;
    const search = searches.items.find((item) => item.id === savedSearchId);
    if (search?.query == null) {
      toast.show({
        tone: 'warning',
        title:
          search === undefined
            ? 'That saved search no longer exists'
            : `“${search.name}” no longer works in this version`,
        description: 'Showing all events instead.',
      });
    }
    void navigate({
      to: '/discover',
      search: {
        tab: 'all',
        view: 'recommended',
        filters: search?.query == null ? {} : filtersOfSaved(search.query),
      },
      replace: true,
    });
  }, [navigate, savedSearchId, searches.isPending, searches.items, toast]);

  return null;
}
