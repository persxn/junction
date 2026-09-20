import type { BackendConnection } from '@compintel/contracts';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { useState } from 'react';

import { createQueryClient } from '../api/query.js';
import { useLiveUpdates } from '../api/use-live-updates.js';
import { AuthProvider, useAuth } from '../auth/auth-context.js';
import { ChangePasswordScreen, LockScreen, LoginScreen } from '../auth/AuthScreens.js';
import { ConnectionScreen } from '../components/ConnectionScreen.js';
import { ErrorBoundary } from '../components/ErrorBoundary.js';
import { ToastProvider, useToast } from '../components/toast/ToastProvider.js';
import { useIdleTimer } from '../lib/use-idle-timer.js';
import { openLogsFolder, retryBackend } from '../shell/backend.js';
import { copyDiagnostics, formatDiagnostics } from '../shell/diagnostics.js';
import { useBackend } from '../shell/use-backend.js';
import { ThemeProvider } from '../theme/theme-context.js';
import { createAppRouter } from './router.js';

/**
 * The application root and its two gates.
 *
 * The first is the backend: while there is none, the whole window is
 * `<ConnectionScreen>` (ruling R26), because nothing in CompIntel works without
 * the local service. The second is the session (§10.3): login, the forced
 * password change (R38) and the lock screen (R37) each take the whole window
 * too, so there is never a half-usable app behind a modal.
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
  const { status, connection, settings, transport, error, refresh } = useBackend();
  const toast = useToast();

  if (status?.phase === 'READY' && connection !== undefined) {
    return <SessionGate connection={connection} />;
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

/**
 * The session half of the app: who is signed in, and which screen that means.
 *
 * It is a component of its own, and exported, so the flow tests can mount it
 * against a stubbed API without also having to fake the shell's IPC and the
 * backend lifecycle that `<BackendGate>` is about.
 */
export function SessionGate({
  connection,
}: {
  readonly connection: BackendConnection;
}): React.JSX.Element {
  return (
    <AuthProvider connection={connection}>
      <AuthGate connection={connection} />
    </AuthProvider>
  );
}

function AuthGate({ connection }: { readonly connection: BackendConnection }): React.JSX.Element {
  const { status, me, can, lock, refresh } = useAuth();
  const [router] = useState(createAppRouter);

  // §10.5: the UI locks itself after the configured idle time. The server is the
  // authority — `idle_expires_at` is what actually ends the session — so this
  // only decides when to put the lock screen up.
  useIdleTimer(status === 'READY' ? me?.session.autoLockMinutes : undefined, lock);

  useLiveUpdates({ connection, enabled: status === 'READY', refresh });

  switch (status) {
    case 'SIGNED_OUT':
      return <LoginScreen />;
    case 'MUST_CHANGE_PASSWORD':
      return <ChangePasswordScreen />;
    case 'LOCKED':
      return <LockScreen />;
    case 'READY':
      return <RouterProvider router={router} context={{ can }} />;
  }
}
