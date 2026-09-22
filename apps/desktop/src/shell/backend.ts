import {
  BackendConnection,
  BackendStatus,
  LoopbackResponse,
  ShellSettings,
  type BackendConnection as Connection,
  type BackendStatus as Status,
  type LoopbackRequest as ProxyRequest,
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
 * The finding-F9 fallback transport (rulings R27 and R78): the shell makes the
 * request on the page's behalf when WebView2 will not let it reach `127.0.0.1`
 * itself.
 *
 * R78 widened it from GET to the five methods the app uses, so Save, Hide, a
 * category override, POST search and every M2 form work on a machine with Local
 * Network Access enforced. The Rust side holds every rule — the path prefix, the
 * system routes and the stream being out, JSON bodies only, the 1 MB limit, and
 * the three headers it will forward — so a refusal here is a message, not a
 * silent no-op.
 */
export async function backendRequest(request: ProxyRequest): Promise<ProxyResponse> {
  return LoopbackResponse.parse(
    await invoke<unknown>('backend_request', {
      request: {
        method: request.method,
        path: request.path,
        headers: { ...request.headers },
        // Rust reads `Option<String>`, which is `null` on this side.
        body: request.body ?? null,
      },
    }),
  );
}

/**
 * §13's "URLs open in the default browser" (ruling R78).
 *
 * `window.open` is refused inside the packaged WebView, which is why "Open
 * registration" did nothing in M1. The shell opens the link instead and refuses
 * anything that is not http, https or mailto; `false` means it was refused, and
 * the caller shows the URL to copy rather than leaving a dead button.
 */
export async function openExternalUrl(url: string): Promise<void> {
  await invoke('open_external', { url });
}

/**
 * Opens the native folder picker and returns what the user chose, or
 * `undefined` if they cancelled (ruling R43).
 *
 * The shell remembers the answer: it is the only evidence it will accept that a
 * human picked a folder, and {@link saveTextFile} will write nowhere else.
 */
export async function pickFolder(title: string): Promise<string | undefined> {
  const picked = await invoke<string | null>('pick_folder', { title });
  return picked ?? undefined;
}

/**
 * Writes a text file into a folder {@link pickFolder} returned. The name must be
 * a plain file name; the shell refuses a path, and refuses to replace an
 * existing file unless `overwrite` says so. Returns the full path written.
 */
export async function saveTextFile(options: {
  readonly folder: string;
  readonly fileName: string;
  readonly contents: string;
  readonly overwrite?: boolean;
}): Promise<string> {
  return invoke<string>('save_text_file', {
    folder: options.folder,
    fileName: options.fileName,
    contents: options.contents,
    overwrite: options.overwrite ?? false,
  });
}

/** Subscribes to lifecycle transitions; the returned function unsubscribes. */
export async function onBackendStatus(handler: (status: Status) => void): Promise<UnlistenFn> {
  return listen<unknown>(BACKEND_STATUS_EVENT, (event) => {
    handler(BackendStatus.parse(event.payload));
  });
}

/**
 * The packaged sign-in window (R74/D-34, WP-14).
 *
 * The shell opens a window on the source's own login page, with its own profile
 * and no way to navigate anywhere else, and hands back the cookies for that
 * source's domains when the professor says they are signed in. The page never
 * sees another site's cookies, and the shell keeps no copy of these.
 */
export interface SignInRequest {
  readonly sourceKey: string;
  readonly loginUrl: string;
  readonly hosts: readonly string[];
}

export interface SignInResult {
  readonly sourceKey: string;
  /** A `Cookie:` header value; empty when nothing was found. */
  readonly cookie: string;
  readonly count: number;
}

export async function openSourceSignIn(request: SignInRequest): Promise<void> {
  await invoke('open_source_signin', { request: { ...request, hosts: [...request.hosts] } });
}

export async function captureSourceSession(request: SignInRequest): Promise<SignInResult> {
  const answer = await invoke<unknown>('capture_source_session', {
    request: { ...request, hosts: [...request.hosts] },
  });
  // Validated rather than trusted, like everything else the shell hands over —
  // and without ever putting the cookie itself through a logger or a store.
  const result = answer as Partial<SignInResult>;
  if (typeof result.cookie !== 'string' || typeof result.count !== 'number') {
    throw new Error('The sign-in window did not answer with a session.');
  }
  return { sourceKey: request.sourceKey, cookie: result.cookie, count: result.count };
}

export async function closeSourceSignIn(): Promise<void> {
  await invoke('close_source_signin');
}
