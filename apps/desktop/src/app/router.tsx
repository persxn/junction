import type { Action } from '@compintel/contracts';
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  redirect,
} from '@tanstack/react-router';

import { UsersPage } from '../features/admin/users/UsersPage.js';
import { DiscoverPage } from '../features/discover/DiscoverPage.js';
import { EventDrawer } from '../features/discover/detail/EventDrawer.js';
import { parseDiscoverSearch } from '../features/discover/search-state.js';
import { CreateEventPage } from '../features/events/create/CreateEventPage.js';
import { SourcesPage } from '../features/admin/sources/SourcesPage.js';
import { AppShell } from './AppShell.js';
import { ADMIN_NAV, MAIN_NAV, type NavItem } from './nav.js';
import { NotFoundPage } from './routes/NotFoundPage.js';
import { PlaceholderPage } from './routes/PlaceholderPage.js';

/**
 * Code-based routes (§4.2: TanStack Router, typed routes).
 *
 * Each rail item is written out rather than generated in a loop, because a loop
 * erases the literal paths and with them the point of a typed router:
 * `<Link to="/discover">` is checked, `<Link to="/discvoer">` is a build error.
 * `nav.ts` still owns the labels and icons, so the two cannot drift.
 *
 * The admin routes are guarded by `beforeLoad` against the router context, which
 * `RouterProvider` refreshes from `/me` (ruling R32). That guard is not the
 * security — §10.1 is explicit that the UI only hides controls — it is what stops
 * a stale bookmark landing on a screen that will only ever show 403s.
 */

export interface RouterContext {
  /** Actions the signed-in account holds, from `/me` (§10.1). */
  readonly can: (action: Action) => boolean;
}

function navItem(id: string): NavItem {
  const item = [...MAIN_NAV, ...ADMIN_NAV].find((candidate) => candidate.id === id);
  if (item === undefined) {
    throw new Error(`nav.ts has no item "${id}"`);
  }
  return item;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: AppShell,
  notFoundComponent: NotFoundPage,
});

/** The one place an admin route's guard is written. */
function adminGuard(action: Action) {
  return ({ context }: { context: RouterContext }): void => {
    if (!context.can(action)) {
      // TanStack Router signals a redirect by throwing its own marker object,
      // which is deliberately not an Error.
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw redirect({ to: '/' });
    }
  };
}

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => <PlaceholderPage item={navItem('dashboard')} />,
});

// WP-16a: the filters live in the search state, so a screen can be restored
// verbatim; the event drawer is a child route, so the list never unmounts and
// keeps its scroll position while an event is open.
export const discoverRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/discover',
  validateSearch: parseDiscoverSearch,
  component: DiscoverPage,
});

export const discoverEventRoute = createRoute({
  getParentRoute: () => discoverRoute,
  path: 'event/$eventId',
  component: EventDrawer,
});

// WP-14: reachable from the palette and from a link, with no rail item of its
// own — §16.1's rail is places, and this is an action.
const createEventRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/events/new',
  component: CreateEventPage,
});

const competitionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/competitions',
  component: () => <PlaceholderPage item={navItem('competitions')} />,
});

const teamsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/teams',
  component: () => <PlaceholderPage item={navItem('teams')} />,
});

const studentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/students',
  component: () => <PlaceholderPage item={navItem('students')} />,
});

const assistantRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/assistant',
  component: () => <PlaceholderPage item={navItem('assistant')} />,
});

const notificationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/notifications',
  component: () => <PlaceholderPage item={navItem('notifications')} />,
});

const adminUsersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin/users',
  beforeLoad: adminGuard('user.manage'),
  component: UsersPage,
});

const adminSourcesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin/sources',
  beforeLoad: adminGuard('source.manage'),
  component: SourcesPage,
});

const adminCategoriesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin/categories',
  beforeLoad: adminGuard('category.manage'),
  component: () => <PlaceholderPage item={navItem('admin-categories')} />,
});

const adminDuplicatesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin/duplicates',
  beforeLoad: adminGuard('duplicate.review'),
  component: () => <PlaceholderPage item={navItem('admin-duplicates')} />,
});

const adminSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin/settings',
  beforeLoad: adminGuard('settings.manage'),
  component: () => <PlaceholderPage item={navItem('admin-campus')} />,
});

const adminBackupsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin/backups',
  beforeLoad: adminGuard('backup.restore'),
  component: () => <PlaceholderPage item={navItem('admin-backups')} />,
});

const adminAuditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin/audit',
  beforeLoad: adminGuard('audit.view_all'),
  component: () => <PlaceholderPage item={navItem('admin-audit')} />,
});

const adminHealthRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin/health',
  beforeLoad: adminGuard('system.health.view'),
  component: () => <PlaceholderPage item={navItem('admin-health')} />,
});

const routeTree = rootRoute.addChildren([
  dashboardRoute,
  discoverRoute.addChildren([discoverEventRoute]),
  createEventRoute,
  competitionsRoute,
  teamsRoute,
  studentsRoute,
  assistantRoute,
  notificationsRoute,
  adminUsersRoute,
  adminSourcesRoute,
  adminCategoriesRoute,
  adminDuplicatesRoute,
  adminSettingsRoute,
  adminBackupsRoute,
  adminAuditRoute,
  adminHealthRoute,
]);

/** Nobody may do anything until `/me` has answered. */
const NO_PERMISSIONS: RouterContext = { can: () => false };

/**
 * In-memory history, in the app as well as in tests.
 *
 * There is no address bar in a desktop window and no deep links into it, and the
 * packaged app is served by Tauri's asset protocol, which has no SPA fallback —
 * so a browser history would only add a way for a reload on `/discover` to land
 * on nothing. `initialPath` exists so a test can start on any route.
 *
 * `context` defaults to "nobody may do anything", which is the right answer until
 * `/me` has been read; `<RouterProvider context={...}>` replaces it. A test that
 * starts on an admin route passes it here instead, because `beforeLoad` runs on
 * the first `load()` — before any provider has had a chance to update it.
 */
export function createAppRouter(
  initialPath = '/',
  context: RouterContext = NO_PERMISSIONS,
): AppRouter {
  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [initialPath] }),
    defaultPreload: false,
    context,
  });
}

export type AppRouter = ReturnType<typeof createRouter<typeof routeTree, 'never', boolean>>;

declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter;
  }
}
