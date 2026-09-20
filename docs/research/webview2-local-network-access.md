# WebView2 and Chromium Local Network Access — measured, WP-05b (2026-09-20)

Finding **F9** / ARCHITECTURE.md §3.2 asks for this check early: *"Run the test once with
`--enable-features=LocalNetworkAccessChecks,msWebViewAllowLocalNetworkAccessChecks` (Chromium Local
Network Access is flag-gated in WebView2 today but may become default). Fallback: route API calls
through Tauri's HTTP plugin."*

This is the result on the build machine. Re-run it whenever WebView2 or Windows is updated, and before
the pilot (WP-31).

## Machine

Windows 11 Home 25H2 (build 26200.9457) · WebView2 runtime **153.0.4234.32** · CompIntel debug build
(`apps/desktop/src-tauri/target/debug/compintel.exe`) · page served from `http://tauri.localhost`
(`useHttpsScheme: false`), backend on `http://127.0.0.1:<random port>`.

## How to run it

```powershell
# 1. Baseline: no flags.
& $exe                       # the window shows "API transport: fetch (direct loopback)"

# 2. With Local Network Access checks forced on.
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS =
  '--enable-features=LocalNetworkAccessChecks,msWebViewAllowLocalNetworkAccessChecks'
& $exe                       # the window shows "API transport: shell proxy (fallback)"
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $null
```

`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` is read by the WebView2 runtime itself, so no code change and
no rebuild is needed to run the check. Evidence to look for, in
`%LOCALAPPDATA%\CompIntel-dev\logs\backend-<date>.log`:

```
{"level":20,…,"method":"GET","route":"/api/v1/health","status":200,…,"msg":"request"}
```

The automated run of all of this is `apps/desktop/src-tauri/tests/…` for the unit level, plus the
session's `shell-05b.ps1` end-to-end script (sections A–D) — see the WP-05b report.

## What happens

| | Flags off (today's default) | Flags on |
|---|---|---|
| Page loads from `http://tauri.localhost` | yes | **yes** |
| Tauri IPC (`invoke`, `listen`, `http://ipc.localhost`) | yes | **yes** |
| `fetch('http://127.0.0.1:<port>/api/v1/health')` | 200 | **never settles** |
| Backend sees the request | yes | no (from the page) |
| After the fallback | — | 200, made by the shell |

**The important detail:** with the checks on, the blocked request does **not** reject. The promise is
left pending — no `TypeError`, no error event, nothing in the log. A fallback that waits for a
rejection therefore never runs, and the UI simply shows empty fields for ever. That is exactly what
happened on the first run of this test.

So the direct request is given a timeout (`FETCH_TIMEOUT_MS`, 5 s, in
`apps/desktop/src/shell/backend.ts`) and a timeout counts as a broken transport, the same as a
`TypeError`. With that in place the app switches to the fallback and works normally under the flags.

## The fallback that shipped

Not Tauri's HTTP plugin. The shell already speaks HTTP to the backend for
`POST /api/v1/system/shutdown`, so the same ~40-line loopback client
(`apps/desktop/src-tauri/src/loopback.rs`) answers a `backend_get` IPC command instead, and no new
dependency or capability was needed. It is deliberately **read-only and prefix-locked**: only `GET`
under `/api/v1/`, no `..`, no backslashes (`loopback::is_proxyable`, unit-tested). The WebView is the
least trusted part of the app and must not get a general-purpose local HTTP client.

Consequences to keep in mind if Local Network Access ever becomes the default:

- SSE (§4.4, ADR-0017) does **not** work over this fallback: it is request/response only. WP-07a's
  authenticated SSE stream would need its own path — most likely Tauri events pushed from the shell,
  or the backend pushing over IPC. Worth deciding before WP-07a if the flags start shipping enabled.
- Every non-GET call (login, edits) would need an equivalent, and each one widens what the WebView can
  ask the shell to do. That is a deliberate design decision, not a mechanical port.
- The page itself and IPC are unaffected, so the app still starts, the tray still works and the
  supervisor is untouched.

## Verdict

- Today, with the shipping WebView2 runtime and no flags, the direct loopback `fetch` works. The app
  uses it (`API transport: fetch (direct loopback)`).
- With the checks forced on, the app keeps working through the shell fallback, automatically, after a
  5 s delay on the first call.
- **Open risk for the pilot:** the 5 s delay is paid once per app start under enforced LNA. If the
  flags become the default, the first-call timeout should shrink (or the shell should probe once at
  startup and tell the UI which transport to use) — recorded as a question for the architect in the
  WP-05b report.
