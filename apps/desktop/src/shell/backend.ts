import {
  BackendConnection,
  BackendStatus,
  HealthResponse,
  type BackendConnection as Connection,
  type BackendStatus as Status,
  type HealthResponse as Health,
} from '@compintel/contracts';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

/** The event the shell emits on every backend lifecycle transition. */
export const BACKEND_STATUS_EVENT = 'backend://status';

/** Header every request to the loopback API carries (ADR-0017). */
export const CLIENT_SECRET_HEADER = 'X-CompIntel-Client';

/**
 * Typed wrappers around the shell's IPC commands. Everything Rust sends is parsed
 * against the contract before the UI sees it: a shape change between the two
 * halves of the app must fail loudly here, not as `undefined` in a component.
 */
export async function backendStatus(): Promise<Status> {
  return BackendStatus.parse(await invoke<unknown>('backend_status'));
}

/** Rejects while the backend is not READY; the UI shows the status screen instead. */
export async function backendConnection(): Promise<Connection> {
  return BackendConnection.parse(await invoke<unknown>('backend_connection'));
}

/** Asks the shell to start the backend again after it gave up (§3.2 "Retry"). */
export async function retryBackend(): Promise<void> {
  await invoke('retry_backend');
}

/** "Exit completely": graceful shutdown, then the process tree goes (§3.2). */
export async function exitCompletely(): Promise<void> {
  await invoke('exit_completely');
}

/** Reveals `<dataDir>\logs` in Explorer - a shell concern, so IPC is allowed. */
export async function openLogsFolder(): Promise<void> {
  await invoke('open_logs_folder');
}

/** Subscribes to lifecycle transitions; the returned function unsubscribes. */
export async function onBackendStatus(handler: (status: Status) => void): Promise<UnlistenFn> {
  return listen<unknown>(BACKEND_STATUS_EVENT, (event) => {
    handler(BackendStatus.parse(event.payload));
  });
}

/**
 * The one API call WP-05a makes: it proves WebView2 can reach the loopback server
 * with the client secret, which is the check §3.2 asks to do early.
 */
export async function fetchHealth(connection: Connection): Promise<Health> {
  const response = await fetch(`${connection.baseUrl}/api/v1/health`, {
    headers: { [CLIENT_SECRET_HEADER]: connection.clientSecret },
  });
  if (!response.ok) {
    throw new Error(`GET /api/v1/health answered ${response.status.toString()}`);
  }
  return HealthResponse.parse(await response.json());
}
