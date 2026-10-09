import type { BackendConnection } from '@compintel/contracts';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { useState } from 'react';

import { createQueryClient } from '../api/query.js';
import { LiveDegradedContext } from '../features/notifications/use-notifications.js';
import { useLiveUpdates } from '../api/use-live-updates.js';
import { AuthProvider, useAuth } from '../auth/auth-context.js';
import { ChangePasswordScreen, LockScreen, LoginScreen } from '../auth/AuthScreens.js';
import { ConnectionScreen } from '../components/ConnectionScreen.js';
import { ConnectSourcesGate } from '../features/setup/ConnectSourcesGate.js';
import { SetupChecking, SetupUnreachable } from '../features/setup/SetupStatusScreens.js';
import { SetupWizard } from '../features/setup/SetupWizard.js';
import { useSetupStatus } from '../features/setup/use-setup-status.js';
import { ErrorBoundary } from '../components/ErrorBoundary.js';
import { ToastProvider, useToast } from '../components/toast/ToastProvider.js';
import { useIdleTimer } from '../lib/use-idle-timer.js';
import { openLogsFolder, retryBackend } from '../shell/backend.js';
import { ConnectionProvider } from '../shell/connection-context.js';
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
    return <SetupGate connection={connection} dataDir={status.dataDir} />;
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
 * The first of the two gates above the session (ruling R39).
 *
 * While setup is required the wizard **is** the application: no router, no
 * login screen, nothing to navigate to. That is not the security — the server
 * answers 409 `SETUP_REQUIRED` on every other route — but it is what makes the
 * §19 criterion "the wizard cannot be skipped" true of the UI as well.
 */
export function SetupGate({
  connection,
  dataDir,
}: {
  readonly connection: BackendConnection;
  readonly dataDir: string | undefined;
}): React.JSX.Element {
  const { state, refresh } = useSetupStatus(connection);

  if (state.kind === 'LOADING') {
    return <SetupChecking />;
  }
  if (state.kind === 'FAILED') {
    return <SetupUnreachable onRetry={refresh} />;
  }
  if (state.status.required) {
    return <SetupWizard connection={connection} dataDir={dataDir} onFinished={refresh} />;
  }
  return <SessionGate connection={connection} />;
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
    <ConnectionProvider connection={connection}>
      <AuthProvider connection={connection}>
        <AuthGate connection={connection} />
      </AuthProvider>
    </ConnectionProvider>
  );
}

function AuthGate({ connection }: { readonly connection: BackendConnection }): React.JSX.Element {
  const { status, me, can, lock, refresh } = useAuth();
  const [router] = useState(createAppRouter);

  // §10.5: the UI locks itself after the configured idle time. The server is the
  // authority — `idle_expires_at` is what actually ends the session — so this
  // only decides when to put the lock screen up.
  useIdleTimer(status === 'READY' ? me?.session.autoLockMinutes : undefined, lock);

  const live = useLiveUpdates({ connection, enabled: status === 'READY', refresh });

  switch (status) {
    case 'SIGNED_OUT':
      return <LoginScreen />;
    case 'MUST_CHANGE_PASSWORD':
      return <ChangePasswordScreen />;
    case 'LOCKED':
      return <LockScreen />;
    case 'READY':
      // R74's one-time "Connect your sources" step sits here, above the router
      // and below sign-in: it needs an administrator's session to store anything,
      // and it must never stand between somebody and the login screen.
      return (
        <ConnectSourcesGate>
          <LiveDegradedContext.Provider value={live.unavailable !== undefined}>
            <RouterProvider router={router} context={{ can }} />
          </LiveDegradedContext.Provider>
        </ConnectSourcesGate>
      );
  }
}
