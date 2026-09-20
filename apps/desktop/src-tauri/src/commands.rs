//! The Tauri IPC surface. ARCHITECTURE.md §3.2 rule 2 allows IPC for shell
//! concerns only - window and tray, opening a path, checking a path - so this file
//! stays short on purpose: everything else the UI needs it asks the backend for
//! over `/api/v1`.

use std::path::Path;
use std::process::Command;
use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::supervisor::{BackendConnection, BackendStatus, Supervisor};

/// The managed state every command reads.
pub struct ShellState {
    pub supervisor: Arc<Supervisor>,
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

/// "Exit completely": graceful backend shutdown, then the app goes away. Runs off
/// the IPC thread because the shutdown handshake may take up to 10 seconds.
#[tauri::command]
pub fn exit_completely(app: AppHandle, state: State<'_, ShellState>) {
    let supervisor = Arc::clone(&state.supervisor);
    std::thread::spawn(move || {
        supervisor.stop();
        app.exit(0);
    });
}

/// Reveals `<dataDir>\logs` in Explorer, for "Open logs" (§3.2).
#[tauri::command]
pub fn open_logs_folder(state: State<'_, ShellState>) -> Result<(), String> {
    let dir = state.supervisor.logs_dir();
    reveal(&dir)
}

fn reveal(dir: &Path) -> Result<(), String> {
    // The folder may not exist yet if the backend never got far enough to create
    // it; showing an empty folder beats an error dialog.
    std::fs::create_dir_all(dir)
        .map_err(|cause| format!("cannot create {}: {cause}", dir.display()))?;
    Command::new("explorer.exe")
        .arg(dir)
        .spawn()
        .map(|_| ())
        // explorer.exe detaches immediately and its exit code is meaningless, so
        // only a failure to start it is worth reporting.
        .map_err(|cause| format!("cannot open {}: {cause}", dir.display()))
}
