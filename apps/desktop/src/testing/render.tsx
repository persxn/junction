import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { render, screen, type RenderResult } from '@testing-library/react';

import { createQueryClient } from '../api/query.js';
import { createAppRouter } from '../app/router.js';
import { ToastProvider } from '../components/toast/ToastProvider.js';
import { ThemeProvider } from '../theme/theme-context.js';

/**
 * Renders a component inside the providers the real app gives it. Tests that
 * skip these end up asserting against a component that could not exist.
 */
export function renderWithProviders(ui: React.ReactNode): RenderResult {
  return render(
    <ThemeProvider>
      <QueryClientProvider client={createQueryClient()}>
        <ToastProvider>{ui}</ToastProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

/**
 * The whole app shell on a given route, with its own router per test.
 *
 * It is async because TanStack Router renders nothing until its first `load()`
 * has resolved; awaiting the rail is what tells us the shell is really up.
 */
export async function renderApp(initialPath = '/'): Promise<RenderResult> {
  const router = createAppRouter(initialPath);
  await router.load();
  const result = renderWithProviders(<RouterProvider router={router} />);
  await screen.findByRole('navigation', { name: 'Main' });
  return result;
}
