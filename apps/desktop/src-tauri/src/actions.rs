//! The things the shell can be asked to do, in one place, because both the tray
//! menu and the UI's IPC commands ask for exactly the same five (§3.2 rule 2:
//! shell concerns only). Keeping them here is what stops the tray and the window
//! from drifting apart.

use std::path::Path;
use std::process::Command;

use tauri::{AppHandle, Manager};
use tauri_plugin_autostart::ManagerExt;

use crate::commands::ShellState;
use crate::settings::ShellSettings;

/// Label of the one window the shell owns (`tauri.conf.json`).
pub const MAIN_WINDOW: &str = "main";

/// Brings the window back from the tray or from being minimised. Also what a
/// second launch does, via the single-instance plugin.
pub fn show_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Hides the window; the backend, its scheduler and its scrapes keep running
/// (D-14).
pub fn hide_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.hide();
    }
}

/// Persists the close-to-tray preference and reflects it in the tray menu.
pub fn set_close_to_tray(app: &AppHandle, enabled: bool) -> Result<ShellSettings, String> {
    let state = app
        .try_state::<ShellState>()
        .ok_or_else(|| "the shell state is not ready".to_owned())?;
    let (settings, error) = state.settings.update(|settings| {
        settings.close_to_tray = enabled;
    });
    state.sync_tray(settings);
    match error {
        Some(cause) => Err(cause),
        None => Ok(settings),
    }
}

/// Persists "start with Windows" *and* asks the platform to make it so. The
/// registry write can fail (policy, a locked profile), and then the setting is
/// rolled back rather than lying to the user.
pub fn set_autostart(app: &AppHandle, enabled: bool) -> Result<ShellSettings, String> {
    let state = app
        .try_state::<ShellState>()
        .ok_or_else(|| "the shell state is not ready".to_owned())?;

    apply_autostart(app, enabled)?;

    let (settings, error) = state.settings.update(|settings| {
        settings.autostart = enabled;
    });
    state.sync_tray(settings);
    match error {
        Some(cause) => Err(cause),
        None => Ok(settings),
    }
}

/// Makes the platform agree with `enabled`, doing nothing when it already does.
/// On Windows this is the `HKCU\…\Run` entry the autostart plugin manages.
pub fn apply_autostart(app: &AppHandle, enabled: bool) -> Result<(), String> {
    let manager = app.autolaunch();
    let current = manager
        .is_enabled()
        .map_err(|cause| format!("cannot read the autostart setting: {cause}"))?;
    if current == enabled {
        return Ok(());
    }
    let result = if enabled {
        manager.enable()
    } else {
        manager.disable()
    };
    result.map_err(|cause| {
        format!(
            "cannot {} starting with Windows: {cause}",
            if enabled { "enable" } else { "disable" }
        )
    })
}

/// Reveals `<dataDir>\logs` in Explorer (§3.2 "Open logs").
pub fn open_logs(app: &AppHandle) -> Result<(), String> {
    let state = app
        .try_state::<ShellState>()
        .ok_or_else(|| "the shell state is not ready".to_owned())?;
    reveal(&state.supervisor.logs_dir())
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

/// "Exit completely" (§3.2): stop the backend politely, then let the app go.
/// Runs on its own thread because the handshake may take up to 10 seconds.
pub fn exit_completely(app: &AppHandle) {
    let handle = app.clone();
    std::thread::spawn(move || {
        if let Some(state) = handle.try_state::<ShellState>() {
            state.supervisor.stop();
        }
        handle.exit(0);
    });
}
