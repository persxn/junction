import {
  BackendConnection,
  BackendStatus,
  LoopbackResponse,
  ShellSettings,
  type BackendConnection as Connection,
  type BackendStatus as Status,
  type LoopbackResponse as ProxyResponse,
  type ShellSettings as Settings,
} from '@compintel/contracts';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

/**
 * Typed wrappers around the shell's IPC commands (ARCHITECTURE.md §3.2 rule 2:
 * IPC for shell concerns only — window, tray, paths — everything else goes over
 * `/api/v1`). Everything Rust sends is parsed against the contract before the UI
 * sees it, so a shape change between the two halves of the app fails loudly here
 * instead of turning into `undefined` inside a component (ruling R24).
 *
 * The API client that sits on top of this is `src/api/client.ts`.
 */

/** The event the shell emits on every backend lifecycle transition. */
export const BACKEND_STATUS_EVENT = 'backend://status';

export async function backendStatus(): Promise<Status> {
  return BackendStatus.parse(await invoke<unknown>('backend_status'));
}

/** Rejects while the backend is not READY; the UI shows `<ConnectionScreen>`. */
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

/** Hides the window; the backend and its scheduler keep running (D-14). */
export async function hideToTray(): Promise<void> {
  await invoke('hide_to_tray');
}

/** Reveals `<dataDir>\logs` in Explorer — a shell concern, so IPC is allowed. */
export async function openLogsFolder(): Promise<void> {
  await invoke('open_logs_folder');
}

/** The shell's machine-level preferences (D-14, §4.1, ruling R28). */
export async function shellSettings(): Promise<Settings> {
  return ShellSettings.parse(await invoke<unknown>('shell_settings'));
}

/** Turns close-to-tray on or off; the tray menu is re-ticked by the shell. */
export async function setCloseToTray(enabled: boolean): Promise<Settings> {
  return ShellSettings.parse(await invoke<unknown>('set_close_to_tray', { enabled }));
}

/** Turns "start with Windows" on or off, registry entry included. */
export async function setAutostart(enabled: boolean): Promise<Settings> {
  return ShellSettings.parse(await invoke<unknown>('set_autostart', { enabled }));
}

/**
 * The finding-F9 fallback transport (ruling R27): the shell makes the GET on the
 * page's behalf when WebView2 will not let it reach `127.0.0.1` itself. Read-only
 * and prefix-locked on the Rust side; widening it needs a ruling. It forwards
 * the session bearer token, and nothing else.
 */
export async function backendGet(path: string, authorization?: string): Promise<ProxyResponse> {
  return LoopbackResponse.parse(
    await invoke<unknown>('backend_get', {
      path,
      // Ruling R27: the session token is forwarded so authenticated reads work
      // over the fallback too. The shell never keeps it.
      authorization: authorization ?? null,
    }),
  );
}

/** Subscribes to lifecycle transitions; the returned function unsubscribes. */
export async function onBackendStatus(handler: (status: Status) => void): Promise<UnlistenFn> {
  return listen<unknown>(BACKEND_STATUS_EVENT, (event) => {
    handler(BackendStatus.parse(event.payload));
  });
}
