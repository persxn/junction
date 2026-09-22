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
use crate::external;
use crate::files::{self, WriteRefusal};
use crate::loopback::{self, LoopbackResponse, OutgoingRequest, ProxyRequest};
use crate::settings::{SettingsStore, ShellSettings};
use crate::signin::{self, SignInRequest, SignInResult};
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

/// The finding-F9 fallback (rulings R27 and R78): the shell makes the request
/// on the page's behalf when WebView2 will not let it reach `127.0.0.1` itself.
///
/// R78 widened this from GET to the five methods the app's own screens use,
/// because a read-only fallback meant Save, Hide, a category override, POST
/// search and every M2 form failed on a machine with Local Network Access
/// enforced — invisibly here, totally there.
///
/// It is still not a general-purpose local HTTP client. `loopback::authorise`
/// holds every rule: the method, the `/api/v1/` prefix minus the system routes
/// and the stream, JSON bodies only, the backend's own 1 MB limit, and the three
/// headers the page may ask to have forwarded. The client secret is added here,
/// from the shell's own state, and never taken from the page.
#[tauri::command]
pub fn backend_request(
    state: State<'_, ShellState>,
    request: ProxyRequest,
) -> Result<LoopbackResponse, String> {
    let (method, authorization) =
        loopback::authorise(&request).map_err(|refusal| refusal.message())?;
    let connection = state.supervisor.connection()?;
    let port = connection
        .base_url
        .rsplit(':')
        .next()
        .and_then(|port| port.parse::<u16>().ok())
        .ok_or_else(|| format!("cannot read a port out of {}", connection.base_url))?;
    loopback::request(
        &OutgoingRequest {
            method: &method,
            path: &request.path,
            port,
            secret: &connection.client_secret,
            authorization,
            body: request.body.as_deref(),
        },
        PROXY_TIMEOUT,
    )
}

/// §13's "URLs open in the default browser" (ruling R78).
///
/// http, https and mailto only; `external::authorise` is where that is decided
/// and where a refusal gets the sentence the page shows beside the URL to copy.
#[tauri::command]
pub fn open_external(url: String) -> Result<(), String> {
    external::open(&url)
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

/// Opens the packaged sign-in window for one source (R74/D-34, WP-14).
///
/// The professor signs in there with their own account, in a window with its
/// own profile that can load nothing but that source's own pages. Nothing is
/// typed for them and nothing is read until they say they are done.
#[tauri::command]
pub fn open_source_signin(
    app: AppHandle,
    state: State<'_, ShellState>,
    request: SignInRequest,
) -> Result<(), String> {
    let data_dir = PathBuf::from(state.supervisor.status().data_dir);
    signin::open(&app, &data_dir, &request)
}

/// Takes that source's cookies out of the sign-in window and closes it.
///
/// The value goes straight to `PUT /admin/sources/:key/session`; the shell keeps
/// no copy, writes it to no file and logs nothing about it.
#[tauri::command]
pub fn capture_source_session(
    app: AppHandle,
    request: SignInRequest,
) -> Result<SignInResult, String> {
    signin::capture(&app, &request)
}

/// Closes the sign-in window without reading anything.
#[tauri::command]
pub fn close_source_signin(app: AppHandle) {
    signin::close(&app);
}
