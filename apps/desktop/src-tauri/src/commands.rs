//! The Tauri IPC surface. ARCHITECTURE.md §3.2 rule 2 allows IPC for shell
//! concerns only - window and tray, opening a path, checking a path - so this file
//! stays short on purpose: everything else the UI needs it asks the backend for
//! over `/api/v1`.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{AppHandle, State};

use crate::actions;
use crate::loopback::{self, LoopbackResponse};
use crate::settings::{SettingsStore, ShellSettings};
use crate::supervisor::{BackendConnection, BackendStatus, Supervisor};
use crate::tray::TrayHandles;

/// How long a proxied request may take before the UI is told it failed.
const PROXY_TIMEOUT: Duration = Duration::from_secs(15);

/// The managed state every command reads.
pub struct ShellState {
    pub supervisor: Arc<Supervisor>,
    pub settings: Arc<SettingsStore>,
    /// Set once the tray exists; `None` in the window between setup and tray.
    pub tray: Mutex<Option<TrayHandles>>,
}

impl ShellState {
    /// Re-ticks the tray's check items after a change made anywhere else.
    pub fn sync_tray(&self, settings: ShellSettings) {
        if let Some(handles) = self
            .tray
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .as_ref()
        {
            handles.sync(settings);
        }
    }
}

/// Current lifecycle state, for the connection banner and the error screen.
#[tauri::command]
pub fn backend_status(state: State<'_, ShellState>) -> BackendStatus {
    state.supervisor.status()
}

/// `{baseUrl, clientSecret, generation}` (ruling A2), or why there is none yet.
/// The UI calls this again after any network error: a higher `generation` means
/// the backend restarted and the previous secret is dead.
#[tauri::command]
pub fn backend_connection(state: State<'_, ShellState>) -> Result<BackendConnection, String> {
    state.supervisor.connection()
}

/// The "Retry" button on the *background service stopped* screen (§3.2).
#[tauri::command]
pub fn retry_backend(state: State<'_, ShellState>) {
    state.supervisor.retry();
}

/// "Exit completely": graceful backend shutdown, then the app goes away.
#[tauri::command]
pub fn exit_completely(app: AppHandle) {
    actions::exit_completely(&app);
}

/// Reveals `<dataDir>\logs` in Explorer, for "Open logs" (§3.2).
#[tauri::command]
pub fn open_logs_folder(app: AppHandle) -> Result<(), String> {
    actions::open_logs(&app)
}

/// The shell's own preferences: close-to-tray and start-with-Windows.
#[tauri::command]
pub fn shell_settings(state: State<'_, ShellState>) -> ShellSettings {
    state.settings.get()
}

/// Turns close-to-tray on or off (D-14) and re-ticks the tray menu.
#[tauri::command]
pub fn set_close_to_tray(app: AppHandle, enabled: bool) -> Result<ShellSettings, String> {
    actions::set_close_to_tray(&app, enabled)
}

/// Turns "start with Windows" on or off, registry entry and all.
#[tauri::command]
pub fn set_autostart(app: AppHandle, enabled: bool) -> Result<ShellSettings, String> {
    actions::set_autostart(&app, enabled)
}

/// Hides the window without stopping anything, the same as closing it while
/// close-to-tray is on.
#[tauri::command]
pub fn hide_to_tray(app: AppHandle) {
    actions::hide_window(&app);
}

/// The finding-F9 fallback: a read-only window onto the API for the case where
/// WebView2 will not let the page reach `127.0.0.1` itself. Only GETs under
/// `/api/v1/` are allowed through - the WebView is the least trusted part of the
/// app, and this must not become a general-purpose local HTTP client.
#[tauri::command]
pub fn backend_get(state: State<'_, ShellState>, path: String) -> Result<LoopbackResponse, String> {
    if !loopback::is_proxyable("GET", &path) {
        return Err(format!("{path} is not a proxyable API path"));
    }
    let connection = state.supervisor.connection()?;
    let port = connection
        .base_url
        .rsplit(':')
        .next()
        .and_then(|port| port.parse::<u16>().ok())
        .ok_or_else(|| format!("cannot read a port out of {}", connection.base_url))?;
    loopback::request("GET", &path, port, &connection.client_secret, PROXY_TIMEOUT)
}
