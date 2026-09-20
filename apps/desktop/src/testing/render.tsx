import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { render, screen, type RenderResult } from '@testing-library/react';

import { createQueryClient } from '../api/query.js';
import { ConnectionProvider } from '../shell/connection-context.js';
import type { AuthView } from '../auth/auth-context.js';
import { createAppRouter } from '../app/router.js';
import { ToastProvider } from '../components/toast/ToastProvider.js';
import { ThemeProvider } from '../theme/theme-context.js';
import { mockAuth, MockAuthProvider, type MockAuthOptions } from './auth.js';

/** A connection that points nowhere; tests that make calls stub `fetch`. */
export const TEST_CONNECTION = {
  baseUrl: 'http://127.0.0.1:52991',
  clientSecret: 'a'.repeat(64),
  generation: 2,
} as const;

/**
 * Renders a component inside the providers the real app gives it. Tests that
 * skip these end up asserting against a component that could not exist.
 */
export function renderWithProviders(ui: React.ReactNode): RenderResult {
  return render(
    <ThemeProvider>
      <QueryClientProvider client={createQueryClient()}>
        <ConnectionProvider connection={TEST_CONNECTION}>
          <ToastProvider>{ui}</ToastProvider>
        </ConnectionProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

export interface AppRenderResult extends RenderResult {
  /** The stubbed session the shell was rendered with; its calls are spies. */
  readonly auth: AuthView;
}

/**
 * The whole app shell on a given route, signed in.
 *
 * The shell needs a session: since WP-07a the rail and the user menu both call
 * `useAuth()`, and the admin routes are guarded against the router context. The
 * default account is a professor — an ordinary user with no admin capabilities —
 * and `{ roles: ['ADMINISTRATOR'] }` is how a test asks for the other case.
 *
 * It is async because TanStack Router renders nothing until its first `load()`
 * has resolved; awaiting the rail is what tells us the shell is really up.
 */
export async function renderApp(
  initialPath = '/',
  options: MockAuthOptions = {},
): Promise<AppRenderResult> {
  const auth = mockAuth(options);
  const context = { can: auth.can };
  const router = createAppRouter(initialPath, context);
  await router.load();
  const result = renderWithProviders(
    <MockAuthProvider value={auth}>
      <RouterProvider router={router} context={context} />
    </MockAuthProvider>,
  );
  await screen.findByRole('navigation', { name: 'Main' });
  return { ...result, auth };
}
