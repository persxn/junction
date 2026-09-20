import type { BackendConnection } from '@compintel/contracts';
import { createContext, use } from 'react';

/**
 * The live backend connection, for screens far enough down the tree that
 * threading it through props would mean touching every component in between.
 *
 * It is provided once, above the router, by the gate that already has it. There
 * is deliberately no default: a screen that renders without a connection is a
 * screen that would make requests to nowhere, and that should be a loud error
 * rather than a silent no-op.
 */
export const ConnectionContext = createContext<BackendConnection | undefined>(undefined);

export function ConnectionProvider({
  connection,
  children,
}: {
  readonly connection: BackendConnection;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return <ConnectionContext value={connection}>{children}</ConnectionContext>;
}

export function useBackendConnection(): BackendConnection {
  const connection = use(ConnectionContext);
  if (connection === undefined) {
    throw new Error('useBackendConnection() needs a <ConnectionProvider> above it');
  }
  return connection;
}
