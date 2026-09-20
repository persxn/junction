//! The Tauri IPC surface. ARCHITECTURE.md §3.2 rule 2 allows IPC for shell
//! concerns only - window and tray, opening a path, checking a path - so this file
//! stays short on purpose: everything else the UI needs it asks the backend for
//! over `/api/v1`.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

use crate::actions;
use crate::files::{self, WriteRefusal};
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
    /// Folders the user picked in a native dialog during this run (ruling R43).
    /// The only places `save_text_file` will write. Empty until a dialog is used.
    pub picked_folders: Mutex<Vec<PathBuf>>,
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
///
/// Ruling R27 adds `authorization`: the session bearer token the page already
/// holds, forwarded so that authenticated reads work over the fallback too. It
/// widens nothing else - the method and the path prefix are locked exactly as
/// they were, and the shell never stores the token.
#[tauri::command]
pub fn backend_get(
    state: State<'_, ShellState>,
    path: String,
    authorization: Option<String>,
) -> Result<LoopbackResponse, String> {
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
    loopback::request(
        "GET",
        &path,
        port,
        &connection.client_secret,
        authorization.as_deref(),
        PROXY_TIMEOUT,
    )
}

/// Opens the native folder picker and remembers what came back (ruling R43).
///
/// Remembering is the point: the page gets a path it can show, and the shell
/// gets the only evidence it will ever accept that a human chose that folder.
/// `None` means the user cancelled, which is not an error.
#[tauri::command]
pub async fn pick_folder(app: AppHandle, title: String) -> Result<Option<String>, String> {
    let (sender, receiver) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .set_title(&title)
        .pick_folder(move |picked| {
            // The receiver is dropped only if the command was cancelled, in
            // which case there is nothing to deliver the answer to.
            let _ = sender.send(picked);
        });

    let picked = receiver
        .recv()
        .map_err(|cause| format!("the folder dialog closed unexpectedly: {cause}"))?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = picked
        .into_path()
        .map_err(|cause| format!("that folder has no usable path: {cause}"))?;

    let state = app
        .try_state::<ShellState>()
        .ok_or_else(|| "the shell is not ready".to_owned())?;
    let mut folders = state
        .picked_folders
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if !folders.iter().any(|known| known == &path) {
        folders.push(path.clone());
    }
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// Writes a text file into a folder the user picked, and nowhere else (R43).
///
/// The wizard uses it for the recovery file. `file_name` must be a plain name:
/// the folder comes from the shell's own record of the dialog, so the page
/// cannot redirect the write by dressing a path up as a file name.
#[tauri::command]
pub fn save_text_file(
    state: State<'_, ShellState>,
    folder: String,
    file_name: String,
    contents: String,
    overwrite: bool,
) -> Result<String, String> {
    let picked = state
        .picked_folders
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clone();
    let target = files::authorise_write(
        std::path::Path::new(&folder),
        &file_name,
        overwrite,
        &picked,
        &|path| path.exists(),
    )
    .map_err(WriteRefusal::message)?;

    std::fs::write(&target, contents)
        .map_err(|cause| format!("could not write the file: {cause}"))?;
    Ok(target.to_string_lossy().into_owned())
}
