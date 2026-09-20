import {
  ApiTransport,
  BackendConnection,
  BackendStatus,
  HealthResponse,
  LoopbackResponse,
  ShellSettings,
  type ApiTransport as Transport,
  type BackendConnection as Connection,
  type BackendStatus as Status,
  type HealthResponse as Health,
  type ShellSettings as Settings,
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

/** Hides the window; the backend and its scheduler keep running (D-14). */
export async function hideToTray(): Promise<void> {
  await invoke('hide_to_tray');
}

/** Reveals `<dataDir>\logs` in Explorer - a shell concern, so IPC is allowed. */
export async function openLogsFolder(): Promise<void> {
  await invoke('open_logs_folder');
}

/** The shell's machine-level preferences (D-14, §4.1). */
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

/** Subscribes to lifecycle transitions; the returned function unsubscribes. */
export async function onBackendStatus(handler: (status: Status) => void): Promise<UnlistenFn> {
  return listen<unknown>(BACKEND_STATUS_EVENT, (event) => {
    handler(BackendStatus.parse(event.payload));
  });
}

/**
 * Which transport the API calls are using. It starts as `FETCH` and only ever
 * moves to `SHELL`, the finding-F9 fallback, after the WebView has proved it
 * cannot reach `127.0.0.1` itself.
 */
let transport: Transport = 'FETCH';

export function apiTransport(): Transport {
  return transport;
}

/** Test seam: puts the transport back to its initial state. */
export function resetApiTransport(): void {
  transport = ApiTransport.parse('FETCH');
}

/** An API call that answered with a status the UI should handle, not retry. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, path: string) {
    super(`GET ${path} answered ${status.toString()}`);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * How long a direct request may take before it is treated as a broken transport.
 *
 * This is not a nicety. With Chromium Local Network Access checks enabled
 * (`--enable-features=LocalNetworkAccessChecks`) WebView2 does not reject the
 * request to `127.0.0.1` - it leaves the promise **pending**, so a fallback that
 * only watches for a rejection waits forever. Measured on this machine during
 * WP-05b; see docs/research/webview2-local-network-access.md.
 */
export const FETCH_TIMEOUT_MS = 5_000;

/** Per-call overrides; the defaults are what the app uses. */
export interface ApiGetOptions {
  /** How long the direct request may take before the fallback is used. */
  readonly timeoutMs?: number;
}

async function getViaFetch(
  connection: Connection,
  path: string,
  timeoutMs: number,
): Promise<unknown> {
  const response = await fetch(`${connection.baseUrl}${path}`, {
    headers: { [CLIENT_SECRET_HEADER]: connection.clientSecret },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new ApiError(response.status, path);
  }
  return response.json();
}

async function getViaShell(path: string): Promise<unknown> {
  const answer = LoopbackResponse.parse(await invoke<unknown>('backend_get', { path }));
  if (answer.status < 200 || answer.status >= 300) {
    throw new ApiError(answer.status, path);
  }
  return JSON.parse(answer.body);
}

/**
 * One GET against the loopback API.
 *
 * `fetch` from the WebView is the normal path (§3.2 fixes the CORS and Host
 * allowlists for exactly this). A *transport* failure - a `TypeError` from a CORS
 * refusal or a dead socket, or the timeout above when the request is silently
 * held - switches this process over to asking the shell to make the request, and
 * it stays switched (finding F9's fallback). An HTTP status is a real answer and
 * is never a reason to switch.
 */
export async function apiGet(
  connection: Connection,
  path: string,
  options: ApiGetOptions = {},
): Promise<unknown> {
  if (transport === 'SHELL') {
    return getViaShell(path);
  }
  try {
    return await getViaFetch(connection, path, options.timeoutMs ?? FETCH_TIMEOUT_MS);
  } catch (cause) {
    if (cause instanceof ApiError) {
      throw cause;
    }
    transport = 'SHELL';
    return getViaShell(path);
  }
}

/**
 * The one API call WP-05a/05b make: it proves the WebView can reach the loopback
 * server with the client secret, which is the check §3.2 asks to do early.
 */
export async function fetchHealth(
  connection: Connection,
  options: ApiGetOptions = {},
): Promise<Health> {
  return HealthResponse.parse(await apiGet(connection, '/api/v1/health', options));
}
