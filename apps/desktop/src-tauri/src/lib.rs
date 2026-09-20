//! CompIntel desktop shell (ARCHITECTURE.md §3.2, ADR-0001, ADR-0002).
//!
//! The shell is deliberately thin: a window, the backend supervisor and a handful
//! of IPC commands. No business logic, no database, no network beyond the loopback
//! shutdown request - all of that belongs to the backend.

pub mod backoff;
pub mod commands;
pub mod job;
pub mod paths;
pub mod ready;
pub mod secret;
pub mod shutdown;
pub mod supervisor;

use std::path::{Path, PathBuf};
use std::sync::Arc;

use tauri::{Emitter, Manager, RunEvent};

use crate::commands::ShellState;
use crate::paths::{PathInputs, ShellPaths};
use crate::supervisor::{Supervisor, SupervisorConfig};

/// The event the UI listens to for every lifecycle transition.
pub const BACKEND_STATUS_EVENT: &str = "backend://status";

/// This build's version, the same string the backend reports on `/health`.
pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Resolves the backend paths for a real run: the process environment, Tauri's
/// resource directory and the filesystem.
fn shell_paths(resource_dir: Option<PathBuf>) -> ShellPaths {
    let env = |key: &str| std::env::var(key).ok();
    let exists = |path: &Path| path.exists();
    paths::resolve(&PathInputs {
        env: &env,
        resource_dir,
        manifest_dir: PathBuf::from(env!("CARGO_MANIFEST_DIR")),
        dev: cfg!(debug_assertions),
        exists: &exists,
    })
}

/// Builds and runs the shell. Returns only when the app has exited.
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::backend_status,
            commands::backend_connection,
            commands::retry_backend,
            commands::exit_completely,
            commands::open_logs_folder,
        ])
        .setup(|app| {
            let resource_dir = app.path().resource_dir().ok();
            let paths = shell_paths(resource_dir);

            let mut config = SupervisorConfig::new(paths, APP_VERSION);
            if cfg!(debug_assertions) {
                // Debug logging in a dev run; the secret still comes from the
                // environment, so no connection file is written.
                config.extra_args.push("--dev".to_owned());
            }

            let handle = app.handle().clone();
            let supervisor = Arc::new(Supervisor::new(
                config,
                Arc::new(move |status| {
                    // A failed emit means the window is already gone; there is
                    // nothing useful to do about it here.
                    let _ = handle.emit(BACKEND_STATUS_EVENT, status);
                }),
            )?);

            app.manage(ShellState {
                supervisor: Arc::clone(&supervisor),
            });
            supervisor.start();
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("the Tauri application must build")
        .run(|handle, event| {
            // Whatever closes the app - the window's X, "Exit completely", the
            // task bar - the backend is stopped before the process goes, so no
            // child is left holding the data-directory lock.
            if matches!(event, RunEvent::Exit)
                && let Some(state) = handle.try_state::<ShellState>()
            {
                state.supervisor.stop();
            }
        });
}
