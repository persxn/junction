import type { RankedEventListItem } from '@compintel/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { AlertTriangle, ExternalLink, EyeOff, Star, UserPlus, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import { isApiProblem } from '../../../api/problem.js';
import { Skeleton } from '../../../components/Skeleton.js';
import { useToast } from '../../../components/toast/ToastProvider.js';
import { useAuth } from '../../../auth/auth-context.js';
import { openExternal } from '../../../lib/external.js';
import { useGlobalHotkeys, type Hotkey } from '../../../lib/hotkeys.js';
import { useNow } from '../../../lib/use-now.js';
import { flatItems, type Pages } from '../cache.js';
import { useAssign } from '../../competitions/assign/assign-context.js';
import { useEventActions } from '../use-event-actions.js';
import { countdown } from '../urgency.js';
import { CategoryChips } from './CategoryChips.js';
import { ChangeHistory } from './ChangeHistory.js';
import { ConflictPanel } from './ConflictPanel.js';
import { DeadlineTimeline } from './DeadlineTimeline.js';
import { FactsGrid } from './FactsGrid.js';
import { SourcesList } from './SourcesList.js';
import { useCategoryOverride, useEventDetail } from './use-event-detail.js';

/**
 * The event detail drawer (§16.2, WP-16b).
 *
 * It opens **over** the list, which never unmounts, so Discover keeps its
 * place: focus moves into the drawer and is trapped there, Esc closes it and
 * returns focus to the card that opened it, and the open event's id lives in
 * the route so a refetch or a deep link lands back on the same drawer.
 *
 * Everything below the header is a section of §16.2's list, in its order, and
 * every one of them is drawn from the single `/events/:id/detail` answer — the
 * sections appear together or not at all.
 */
export function EventDrawer(): React.JSX.Element {
  const { eventId } = useParams({ from: '/discover/event/$eventId' });
  const assign = useAssign();
  const navigate = useNavigate();
  const search = useSearch({ from: '/discover' });
  const client = useQueryClient();
  const panel = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const now = useNow();
  const toast = useToast();
  const auth = useAuth();
  const actions = useEventActions();
  const detail = useEventDetail(eventId);
  const override = useCategoryOverride(eventId);

  const card = useMemo<RankedEventListItem | undefined>(() => {
    for (const [, data] of client.getQueriesData<Pages>({ queryKey: ['events', 'list'] })) {
      const found = flatItems(data).find((candidate) => candidate.id === eventId);
      if (found !== undefined) return found;
    }
    return undefined;
  }, [client, eventId]);

  const close = useCallback((): void => {
    void navigate({ to: '/discover', search });
  }, [navigate, search]);

  const hotkeys = useMemo<readonly Hotkey[]>(
    () => [{ key: 'Escape', allowWhileTyping: true, onPress: close }],
    [close],
  );
  useGlobalHotkeys(hotkeys);

  useEffect(() => {
    heading.current?.focus();
  }, [eventId]);

  // The focus trap. A drawer sitting over a list of focusable cards has to keep
  // Tab inside it, or the next Tab silently moves behind the panel.
  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'Tab' || panel.current === null) return;
    // Everything the drawer renders is on screen — a section it does not show
    // is not in the DOM — so there is nothing to filter for visibility here.
    const focusable = [
      ...panel.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (first === undefined || last === undefined) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const event = detail.data;
  const title = event?.title ?? card?.title ?? 'Event';
  const due = countdown(
    event?.registrationDeadlineAt ?? card?.registrationDeadlineAt ?? null,
    event?.registrationDeadlinePrecision ?? card?.registrationDeadlinePrecision ?? 'UNKNOWN',
    now,
  );
  const DueIcon = due.icon;
  const registration = event?.registrationUrl ?? event?.officialUrl ?? null;

  return (
    <aside
      ref={panel}
      aria-labelledby="event-drawer-title"
      onKeyDown={onKeyDown}
      data-testid="event-drawer"
      // §16.3: 120–200 ms ease-out, and none of it under prefers-reduced-motion.
      className="ci-drawer fixed top-[var(--ci-topbar-height)] right-0 bottom-0 z-20 flex w-[min(520px,92vw)] flex-col gap-4 overflow-y-auto border-l border-line bg-surface-raised p-4 shadow-[var(--ci-shadow-popover)]"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2
            id="event-drawer-title"
            ref={heading}
            tabIndex={-1}
            className="text-lg font-medium outline-offset-2"
          >
            {title}
          </h2>
          <p className="text-sm text-fg-muted">
            {event?.organizerName ?? card?.organizerName ?? 'Organizer not stated'}
          </p>
          <p className={`mt-1 flex items-center gap-1 text-sm font-medium ${due.tone}`}>
            <DueIcon aria-hidden="true" className="size-4" />
            <span className="sr-only">{due.levelLabel}: </span>
            {due.label}
          </p>
        </div>
        <button
          type="button"
          onClick={close}
          aria-label="Close event details"
          aria-keyshortcuts="Escape"
          className="rounded-md p-1.5 text-fg-muted hover:bg-surface-hover"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {card !== undefined && (
          <>
            <button
              type="button"
              aria-pressed={card.watchlisted}
              onClick={() => {
                actions.toggleSave(card);
              }}
              className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-sm hover:bg-surface-hover"
            >
              <Star
                aria-hidden="true"
                className={`size-4 ${card.watchlisted ? 'fill-current text-accent' : ''}`}
              />
              {card.watchlisted ? 'Saved' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => {
                actions.hide(card);
                close();
              }}
              className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-sm hover:bg-surface-hover"
            >
              <EyeOff aria-hidden="true" className="size-4" />
              Hide
            </button>
          </>
        )}
        {registration !== null && (
          <button
            type="button"
            onClick={() => {
              void openExternal(registration).then((opened) => {
                if (!opened) {
                  toast.show({
                    tone: 'warning',
                    title: 'Could not open the link here',
                    description: `Copy it instead: ${registration}`,
                  });
                }
              });
            }}
            className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-sm hover:bg-surface-hover"
          >
            <ExternalLink aria-hidden="true" className="size-4" />
            Open registration
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            assign.open({ id: eventId, title });
          }}
          className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-sm hover:bg-surface-hover"
        >
          <UserPlus aria-hidden="true" className="size-4" />
          Assign
        </button>
      </div>

      {detail.isPending && <Skeleton lines={6} label="Loading event details" />}

      {detail.error !== null && event === undefined && (
        <div
          role="alert"
          className="flex flex-col items-start gap-2 rounded-lg border border-danger p-3"
        >
          <p className="flex items-center gap-2 font-medium text-danger">
            <AlertTriangle aria-hidden="true" className="size-4" />
            {isApiProblem(detail.error) ? detail.error.title : 'This event could not be loaded'}
          </p>
          <button
            type="button"
            onClick={detail.retry}
            className="rounded-md bg-accent px-3 py-1 text-sm font-medium text-on-accent hover:bg-accent-hover"
          >
            Retry
          </button>
        </div>
      )}

      {event !== undefined && (
        <>
          <ConflictPanel conflicts={event.conflicts} now={now} />
          <FactsGrid event={event} now={now} />
          <CategoryChips
            categories={event.categories}
            canOverride={auth.can('event.categorize')}
            isSaving={override.isSaving}
            onSave={override.save}
          />
          {event.descriptionMd !== null && (
            <section aria-labelledby="drawer-description">
              <h3 id="drawer-description" className="mb-2 text-sm font-medium text-fg-muted">
                About
              </h3>
              {/* Sanitized at the adapter boundary (§7.3); rendered as text, never as HTML. */}
              <p className="text-sm whitespace-pre-wrap">{event.descriptionMd}</p>
            </section>
          )}
          <DeadlineTimeline deadlines={event.deadlines} now={now} />
          <SourcesList sources={event.sources} now={now} />
          <ChangeHistory
            items={detail.history}
            now={now}
            hasOlder={detail.hasOlder}
            isLoadingOlder={detail.isLoadingOlder}
            onLoadOlder={detail.loadOlder}
          />
        </>
      )}
    </aside>
  );
}
