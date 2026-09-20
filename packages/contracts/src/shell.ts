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

/** What the shell's proxy command returns. */
export const LoopbackResponse = z.object({
  status: z.int().min(100).max(599),
  body: z.string(),
});
export type LoopbackResponse = z.infer<typeof LoopbackResponse>;
