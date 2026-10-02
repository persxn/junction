//! CompIntel desktop shell (ARCHITECTURE.md §3.2, ADR-0001, ADR-0002).
//!
//! The shell is deliberately thin: a window, a tray, the backend supervisor and a
//! handful of IPC commands. No business logic, no database, no network beyond the
//! loopback calls to our own backend - all of that belongs to the backend.

pub mod actions;
pub mod backoff;
pub mod commands;
pub mod external;
pub mod files;
pub mod job;
pub mod loopback;
pub mod paths;
pub mod picked;
pub mod ready;
pub mod secret;
pub mod session_key;
pub mod settings;
pub mod signin;
pub mod supervisor;
pub mod tray;

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use tauri::{Emitter, Manager, RunEvent, WindowEvent};

use crate::commands::ShellState;
use crate::paths::{PathInputs, ShellPaths};
use crate::settings::SettingsStore;
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
        // Must be registered first (the plugin's own requirement): a second launch
        // hands its arguments to this callback and then exits, so the app is a
        // single instance and the running window comes forward instead.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            actions::show_window(app);
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        // Registered for its **Rust** API only: `pick_folder` calls the dialog
        // from here, so the shell knows which folder a human really chose
        // (ruling R43). The page is deliberately not given the plugin's own
        // JavaScript surface, which would let it open dialogs of its own.
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::backend_status,
            commands::backend_connection,
            commands::retry_backend,
            commands::exit_completely,
            commands::open_logs_folder,
            commands::shell_settings,
            commands::set_close_to_tray,
            commands::set_autostart,
            commands::hide_to_tray,
            commands::backend_request,
            commands::open_external,
            commands::pick_folder,
            commands::save_text_file,
            commands::pick_file,
            commands::read_picked_file,
            commands::open_source_signin,
            commands::capture_source_session,
            commands::close_source_signin,
        ])
        .setup(|app| {
            let resource_dir = app.path().resource_dir().ok();
            let paths = shell_paths(resource_dir);
            let store = Arc::new(SettingsStore::open(&paths.data_dir));
            let preferences = store.get();

            let mut config = SupervisorConfig::new(paths, APP_VERSION);

            // Ruling R76: the data key that seals stored sessions is created on
            // first run, kept DPAPI-protected beside the database and handed to
            // every backend spawn alongside the client secret. Failing to get
            // one is not a reason to refuse to start: the backend is told there
            // is no key, reports sessions as unavailable on this machine, and
            // reads the sources' public pages, which is the state a standalone
            // backend is in already.
            match session_key::ensure(&config.paths.data_dir) {
                Ok(key) => config
                    .extra_env
                    .push((session_key::KEY_ENV.to_owned(), key)),
                Err(cause) => eprintln!("sessions cannot be sealed on this machine: {cause}"),
            }

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
                settings: Arc::clone(&store),
                tray: Mutex::new(None),
                picked_folders: Mutex::new(Vec::new()),
                picked_file: Mutex::new(None),
            });

            // The registry and the saved preference can disagree - the user may
            // have removed the Run entry by hand - so the file wins at startup.
            if let Err(cause) = actions::apply_autostart(app.handle(), preferences.autostart) {
                eprintln!("autostart could not be applied: {cause}");
            }

            let handles = tray::build(app.handle(), preferences)?;
            if let Some(state) = app.try_state::<ShellState>() {
                *state
                    .tray
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(handles);
            }

            supervisor.start();
            Ok(())
        })
        .on_window_event(|window, event| {
            // Close-to-tray (D-14): the window goes away, the backend does not, so
            // scrapes and deadline evaluation keep running. Only "Exit completely"
            // stops everything.
            if let WindowEvent::CloseRequested { api, .. } = event {
                let close_to_tray = window
                    .app_handle()
                    .try_state::<ShellState>()
                    .is_some_and(|state| state.settings.get().close_to_tray);
                if close_to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                } else {
                    actions::exit_completely(window.app_handle());
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("the Tauri application must build")
        .run(|handle, event| {
            // Whatever closes the app - "Exit completely", the task bar, a signed
            // out session - the backend is stopped before the process goes, so no
            // child is left holding the data-directory lock.
            if matches!(event, RunEvent::Exit)
                && let Some(state) = handle.try_state::<ShellState>()
            {
                state.supervisor.stop();
            }
        });
}
