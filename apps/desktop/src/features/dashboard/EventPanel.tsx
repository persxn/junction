import { Link, useNavigate } from '@tanstack/react-router';

import { Skeleton } from '../../components/Skeleton.js';
import { useNow } from '../../lib/use-now.js';
import { useAssign } from '../competitions/assign/assign-context.js';
import { EventCard } from '../discover/EventCard.js';
import { effectiveQuery, type FeaturedView } from '../discover/presets.js';
import { DEFAULT_SEARCH } from '../discover/search-state.js';
import { useEventActions } from '../discover/use-event-actions.js';
import { useEventSearch } from '../discover/use-event-search.js';
import { Panel, PanelError } from './Panels.js';

/**
 * A Discover preset as a Dashboard panel (§16.2, WP-22): five of WP-16a's cards
 * — Nearby, or Recommended (RELEVANCE with no text, each card showing its
 * WP-15b reasons) — with Save, Hide and Assign working as they do on Discover.
 */

export function EventPanel({
  view,
  title,
}: {
  readonly view: FeaturedView;
  readonly title: string;
}): React.JSX.Element {
  const navigate = useNavigate();
  const now = useNow();
  const actions = useEventActions();
  const assign = useAssign();
  const result = useEventSearch(effectiveQuery('featured', view, {}, 5));
  let body: React.JSX.Element;
  if (result.isPending) body = <Skeleton lines={4} label={`Loading ${title.toLowerCase()}`} />;
  else if (result.error !== null && result.items.length === 0) {
    body = <PanelError what={title} error={result.error} retry={result.retry} />;
  } else if (result.items.length === 0) {
    body = (
      <p className="text-sm text-fg-muted">
        Nothing here yet — events appear once the sources have been read.
      </p>
    );
  } else {
    body = (
      <ul aria-label={title} className="flex flex-col gap-2">
        {result.items.slice(0, 5).map((item) => (
          <li key={item.id}>
            <EventCard
              item={item}
              now={now}
              selected={false}
              cardRef={() => undefined}
              onFocusCard={() => undefined}
              onOpen={() => {
                void navigate({
                  to: '/discover/event/$eventId',
                  params: { eventId: item.id },
                  search: DEFAULT_SEARCH,
                });
              }}
              onSave={() => {
                actions.toggleSave(item);
              }}
              onHide={() => {
                actions.hide(item);
              }}
              onAssign={() => {
                assign.open({ id: item.id, title: item.title });
              }}
            />
          </li>
        ))}
      </ul>
    );
  }
  return (
    <Panel
      title={title}
      action={
        <Link
          to="/discover"
          search={{ tab: 'featured', view, filters: {} }}
          className="text-sm hover:underline"
        >
          More on Discover
        </Link>
      }
    >
      {body}
    </Panel>
  );
}
