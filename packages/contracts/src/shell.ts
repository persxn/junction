import { z } from 'zod';

/**
 * The Tauri IPC surface between the shell and the UI (ARCHITECTURE.md §3.2,
 * ruling A2). These are not API DTOs, but they are still a contract between two
 * processes in this repository, so they live beside the others and the UI
 * validates whatever Rust hands it instead of trusting it.
 */

/** Where the supervised backend is in its lifecycle. */
export const BACKEND_PHASES = [
  /** Spawned, waiting for the READY line on stdout. */
  'STARTING',
  /** READY parsed; `backend_connection()` answers. */
  'READY',
  /** It died and the shell is waiting out the restart backoff. */
  'RESTARTING',
  /** Too many crashes in the window, or a `ready:false` line: no more restarts. */
  'FAILED',
  /** "Exit completely" is in progress. */
  'STOPPING',
  /** Stopped on purpose; the app is going away. */
  'STOPPED',
] as const;
export const BackendPhase = z.enum(BACKEND_PHASES);
export type BackendPhase = z.infer<typeof BackendPhase>;

/**
 * What `backend_connection()` returns (A2). `generation` counts spawns: when the
 * UI sees a new one it knows the backend restarted, so the client secret it holds
 * is stale and its SSE streams are gone.
 */
export const BackendConnection = z.object({
  /** `http://127.0.0.1:<port>`, never a name that could resolve elsewhere. */
  baseUrl: z.string().regex(/^http:\/\/127\.0\.0\.1:\d+$/),
  /** 32 random bytes, hex; new for every spawn, so it is never persisted. */
  clientSecret: z.string().regex(/^[0-9a-f]{64}$/),
  /** 1 for the first spawn of this shell run, incremented on every restart. */
  generation: z.int().min(1),
});
export type BackendConnection = z.infer<typeof BackendConnection>;

/** What `backend_status()` returns, for the connection banner and the error screen. */
export const BackendStatus = z.object({
  phase: BackendPhase,
  /** 0 before the first spawn. */
  generation: z.int().min(0),
  /** Present from READY on; absent while starting or after a failure. */
  port: z.int().min(1).max(65535).nullable(),
  /** Crashes inside the rolling window (§3.2: 5 in 10 minutes ends the retries). */
  recentCrashes: z.int().min(0),
  /** Why it is FAILED or RESTARTING; a message, never a stack trace. */
  lastError: z.string().nullable(),
  /** Absolute path of the data directory the backend was given. */
  dataDir: z.string().min(1),
  /** Absolute path of `<dataDir>\logs`, for "Open logs". */
  logsDir: z.string().min(1),
  appVersion: z.string().min(1),
});
export type BackendStatus = z.infer<typeof BackendStatus>;

/**
 * The shell's own machine-level preferences (D-14, §4.1). They live in
 * `<dataDir>\shell-settings.json`, not in the backend's `settings` table: the
 * tray and the window have to behave before the backend is up or any account
 * exists.
 */
export const ShellSettings = z.object({
  /** Closing the window hides it; the backend and its scrapes keep running. */
  closeToTray: z.boolean(),
  /** Start the shell when the user signs in to Windows. */
  autostart: z.boolean(),
});
export type ShellSettings = z.infer<typeof ShellSettings>;

/**
 * How the UI is reaching the loopback API. `FETCH` is the normal path; `SHELL`
 * is the finding-F9 fallback, where the page cannot reach `127.0.0.1` itself
 * (Chromium Local Network Access) and the shell proxies GETs over IPC instead.
 */
export const API_TRANSPORTS = ['FETCH', 'SHELL'] as const;
export const ApiTransport = z.enum(API_TRANSPORTS);
export type ApiTransport = z.infer<typeof ApiTransport>;

/**
 * What the shell may be asked to send over the fallback transport (ruling R78).
 *
 * The shell decides what it will actually forward — `loopback::authorise` is
 * the authority — but the shape is a contract between the two processes like
 * every other one here, so a mismatch fails at the boundary.
 */
export const LoopbackRequest = z.object({
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  /** Under `/api/v1/`, and not a system route or the stream; the shell checks. */
  path: z.string().min(1),
  /** `Authorization`, `Content-Type` and `Accept` only; anything else is refused. */
  headers: z.record(z.string(), z.string()),
  /** A serialized JSON document, or absent for a request without a body. */
  body: z.string().optional(),
});
export type LoopbackRequest = z.infer<typeof LoopbackRequest>;

/**
 * What the shell's proxy command returns: the backend's own answer, verbatim.
 *
 * The headers are `[name, value]` pairs rather than a map because a header may
 * legitimately appear twice, and because the API client reads `Content-Type` off
 * them to tell a problem document from a plain body — the same thing it reads
 * off a `Response` on the direct path.
 */
export const LoopbackResponse = z.object({
  status: z.int().min(100).max(599),
  headers: z.array(z.tuple([z.string(), z.string()])),
  body: z.string(),
});
export type LoopbackResponse = z.infer<typeof LoopbackResponse>;

/**
 * Why the shell will not open a stored path (ruling R102). The shell decides;
 * these are its reasons, each with the sentence the page shows beside the
 * path. A refusal that still lets the item be selected in its folder says so.
 */
export const OPEN_REFUSALS = [
  'NOT_ABSOLUTE',
  'TRAVERSAL',
  'DEVICE_PATH',
  'ALTERNATE_STREAM',
  'TRAILING_DOT_OR_SPACE',
  'RESERVED_NAME',
  'NOT_FOUND',
  'IS_DIRECTORY',
  'BLOCKED_TYPE',
  'UNKNOWN_TYPE',
] as const;
export const OpenRefusal = z.enum(OPEN_REFUSALS);
export type OpenRefusal = z.infer<typeof OpenRefusal>;

export const OPEN_REFUSAL_TEXT: Readonly<Record<OpenRefusal, string>> = {
  NOT_ABSOLUTE: 'Only a full path — a drive letter or a \\\\server\\share — can be opened.',
  TRAVERSAL: 'A path that steps up with “..” can’t be opened from Junction.',
  DEVICE_PATH: 'Device paths can’t be opened from Junction.',
  ALTERNATE_STREAM: 'That path names a hidden part of a file, so it isn’t opened.',
  TRAILING_DOT_OR_SPACE: 'A name ending in a dot or a space can’t be opened from Junction.',
  RESERVED_NAME: 'That name is reserved by Windows, so it isn’t opened.',
  NOT_FOUND: 'Not found on this PC.',
  IS_DIRECTORY: 'That is a folder — use Show in Explorer.',
  BLOCKED_TYPE: 'Programs and scripts can’t be opened from Junction — use Show in Explorer.',
  UNKNOWN_TYPE: 'Junction opens documents, images and archives only — use Show in Explorer.',
};

/** What `stat_paths` found for one path, on this PC. */
export const PATH_STATUSES = ['OK', 'MISSING', 'UNREACHABLE'] as const;
export const PathStatus = z.enum(PATH_STATUSES);
export type PathStatus = z.infer<typeof PathStatus>;

/** `stat_paths(paths)` (R102/R103): each probe with the 3 s network timeout. */
export const StatPathsResult = z.object({
  /** This PC's name, compared with each resource's `machineLabel`. */
  machineLabel: z.string().min(1),
  results: z.array(
    z.object({
      path: z.string(),
      status: PathStatus,
      /** `open_local_path` would open it; otherwise Show in Explorer only. */
      openable: z.boolean(),
      reason: OpenRefusal.nullable(),
    }),
  ),
});
export type StatPathsResult = z.infer<typeof StatPathsResult>;

/** `open_local_path(path)` and `reveal_path(path)`: done, or why not. */
export const PathActionResult = z.discriminatedUnion('done', [
  z.object({ done: z.literal(true) }),
  z.object({ done: z.literal(false), reason: OpenRefusal }),
]);
export type PathActionResult = z.infer<typeof PathActionResult>;

/**
 * The tray's notification surface (R90, R24, WP-23): the UI tells the shell the
 * unread count (the tray badge and tooltip) and hands it CRITICAL notifications
 * to toast. Activation brings the window back and emits `navigate` with the
 * route, which the UI accepts only when it is one of its own.
 */
export const TraySetUnread = z.object({ count: z.int().min(0) });
export type TraySetUnread = z.infer<typeof TraySetUnread>;

export const CriticalToast = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(200),
  body: z.string().max(500),
  /** An internal route, "/competitions/<id>"; the shell refuses anything else. */
  route: z.string().regex(/^\/[A-Za-z0-9/_-]*$/),
});
export type CriticalToast = z.infer<typeof CriticalToast>;

/** The event the shell emits when a toast is clicked. */
export const NAVIGATE_EVENT = 'app://navigate';

/**
 * WP-33: the shell tells the UI the window went to the tray (`false`) or came
 * back (`true`), so decorative animation stops while nobody can see it (R68).
 */
export const VISIBILITY_EVENT = 'app://visibility';
