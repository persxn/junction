import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { useState } from 'react';

import { createQueryClient } from '../api/query.js';
import { ConnectionScreen } from '../components/ConnectionScreen.js';
import { ErrorBoundary } from '../components/ErrorBoundary.js';
import { ToastProvider, useToast } from '../components/toast/ToastProvider.js';
import { openLogsFolder, retryBackend } from '../shell/backend.js';
import { copyDiagnostics, formatDiagnostics } from '../shell/diagnostics.js';
import { useBackend } from '../shell/use-backend.js';
import { ThemeProvider } from '../theme/theme-context.js';
import { createAppRouter } from './router.js';

/**
 * The application root: the providers, and the one decision above the router —
 * is there a backend to talk to at all?
 *
 * While there is not, the whole window is `<ConnectionScreen>` (ruling R26).
 * Rendering the shell with every screen failing underneath it would be worse than
 * one clear message: nothing in CompIntel works without the local service.
 */
export function App(): React.JSX.Element {
  const [queryClient] = useState(createQueryClient);

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <ErrorBoundary label="CompIntel">
            <BackendGate />
          </ErrorBoundary>
        </ToastProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

function BackendGate(): React.JSX.Element {
  const [router] = useState(createAppRouter);
  const { status, settings, transport, error, refresh } = useBackend();
  const toast = useToast();

  if (status?.phase === 'READY') {
    return <RouterProvider router={router} />;
  }

  return (
    <ConnectionScreen
      phase={status?.phase}
      message={status?.lastError}
      dataDir={status?.dataDir}
      onRetry={() => {
        void retryBackend().then(refresh, (cause: unknown) => {
          toast.show({
            tone: 'danger',
            title: 'Could not start the background service',
            description: cause instanceof Error ? cause.message : String(cause),
          });
        });
      }}
      onOpenLogs={() => {
        void openLogsFolder();
      }}
      onCopyDiagnostics={() => {
        void copyDiagnostics(formatDiagnostics({ status, settings, transport, error })).then(
          (copied) => {
            toast.show({
              tone: copied ? 'success' : 'warning',
              title: copied ? 'Diagnostics copied' : 'Could not copy the diagnostics',
              description: copied
                ? 'Paste them into your message to whoever is helping.'
                : 'The clipboard is not available. Open the logs folder instead.',
            });
          },
        );
      }}
    />
  );
}
