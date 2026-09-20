import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';

import { AppShell } from './AppShell.js';
import { MAIN_NAV, type NavItem } from './nav.js';
import { NotFoundPage } from './routes/NotFoundPage.js';
import { PlaceholderPage } from './routes/PlaceholderPage.js';

/**
 * Code-based routes (§4.2: TanStack Router, typed routes).
 *
 * Each rail item is written out rather than generated from `MAIN_NAV` in a loop,
 * because a loop erases the literal paths and with them the point of a typed
 * router: `<Link to="/discover">` is checked, `<Link to="/discvoer">` is a build
 * error. `MAIN_NAV` still owns the labels and icons, so the two cannot drift.
 *
 * Admin routes are not here. See the seam in `nav.ts`: registering them before
 * anything knows the user's role would make them reachable by URL.
 */

function navItem(id: string): NavItem {
  const item = MAIN_NAV.find((candidate) => candidate.id === id);
  if (item === undefined) {
    throw new Error(`nav.ts has no item "${id}"`);
  }
  return item;
}

const rootRoute = createRootRoute({
  component: AppShell,
  notFoundComponent: NotFoundPage,
});

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => <PlaceholderPage item={navItem('dashboard')} />,
});

const discoverRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/discover',
  component: () => <PlaceholderPage item={navItem('discover')} />,
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

const routeTree = rootRoute.addChildren([
  dashboardRoute,
  discoverRoute,
  competitionsRoute,
  teamsRoute,
  studentsRoute,
  assistantRoute,
  notificationsRoute,
]);

/**
 * In-memory history, in the app as well as in tests.
 *
 * There is no address bar in a desktop window and no deep links into it, and the
 * packaged app is served by Tauri's asset protocol, which has no SPA fallback —
 * so a browser history would only add a way for a reload on `/discover` to land
 * on nothing. `initialPath` exists so a test can start on any route.
 */
export function createAppRouter(initialPath = '/'): AppRouter {
  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [initialPath] }),
    defaultPreload: false,
  });
}

export type AppRouter = ReturnType<typeof createRouter<typeof routeTree, 'never', boolean>>;

declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter;
  }
}
