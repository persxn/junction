//! The two machine-level preferences the shell owns: close-to-tray (D-14) and
//! "start with Windows" (§4.1).
//!
//! They live in `<dataDir>\shell-settings.json`, not in the backend's `settings`
//! table (§6.2), because the tray and the window have to behave correctly before
//! the backend is up, before any account exists and even when the database cannot
//! be opened at all. Everything that belongs to a department or a user goes in the
//! database instead.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

/// File name under the data directory.
pub const SETTINGS_FILE: &str = "shell-settings.json";

/// The shell's own preferences.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ShellSettings {
    /// Closing the window hides it instead of exiting, so scraping keeps running
    /// (D-14: on by default, and it can be turned off).
    pub close_to_tray: bool,
    /// Start the shell when the user signs in to Windows.
    pub autostart: bool,
}

impl Default for ShellSettings {
    fn default() -> Self {
        Self {
            close_to_tray: true,
            autostart: false,
        }
    }
}

/// Reads the file, falling back to the defaults. A missing or unreadable file is
/// not an error the user should see: the app has to open either way, and the next
/// change rewrites it.
pub fn load(dir: &Path) -> ShellSettings {
    std::fs::read_to_string(dir.join(SETTINGS_FILE))
        .ok()
        .and_then(|text| parse(&text).ok())
        .unwrap_or_default()
}

/// Parses the file's contents. A byte-order mark is stripped first: Notepad and
/// PowerShell both write one, `serde_json` rejects it, and a hand-edited file
/// must not silently revert every setting to its default - which is exactly what
/// happened during WP-05b's first end-to-end run.
pub fn parse(text: &str) -> Result<ShellSettings, serde_json::Error> {
    serde_json::from_str(text.trim_start_matches('\u{feff}').trim())
}

/// Writes the file, creating the data directory if the backend has not yet.
pub fn save(dir: &Path, settings: ShellSettings) -> Result<(), String> {
    std::fs::create_dir_all(dir)
        .map_err(|cause| format!("cannot create {}: {cause}", dir.display()))?;
    let path = dir.join(SETTINGS_FILE);
    let body = serde_json::to_string_pretty(&settings)
        .map_err(|cause| format!("cannot serialise the shell settings: {cause}"))?;
    std::fs::write(&path, format!("{body}\n"))
        .map_err(|cause| format!("cannot write {}: {cause}", path.display()))
}

/// The live settings, shared by the tray, the window handler and the IPC commands.
pub struct SettingsStore {
    dir: PathBuf,
    current: Mutex<ShellSettings>,
}

impl SettingsStore {
    /// Loads what is on disk; never fails.
    pub fn open(dir: impl Into<PathBuf>) -> Self {
        let dir = dir.into();
        let current = Mutex::new(load(&dir));
        Self { dir, current }
    }

    pub fn get(&self) -> ShellSettings {
        *self
            .current
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Applies a change and persists it. The new value is returned even if the
    /// write failed, so the UI and the tray never disagree with each other.
    pub fn update(
        &self,
        change: impl FnOnce(&mut ShellSettings),
    ) -> (ShellSettings, Option<String>) {
        let updated = {
            let mut current = self
                .current
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            change(&mut current);
            *current
        };
        let error = save(&self.dir, updated).err();
        (updated, error)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let base = std::env::var("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|_| std::env::temp_dir());
        let dir = base
            .join("CompIntel-dev")
            .join("test-tmp")
            .join(format!("settings-{name}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("scratch");
        dir
    }

    #[test]
    fn close_to_tray_is_on_by_default_and_autostart_is_not() {
        let settings = ShellSettings::default();
        assert!(
            settings.close_to_tray,
            "D-14 says close-to-tray defaults on"
        );
        assert!(!settings.autostart);
    }

    #[test]
    fn a_missing_file_reads_as_the_defaults() {
        let dir = scratch("missing");
        let _ = std::fs::remove_file(dir.join(SETTINGS_FILE));
        assert_eq!(load(&dir), ShellSettings::default());
    }

    #[test]
    fn what_is_saved_is_what_is_loaded() {
        let dir = scratch("roundtrip");
        let wanted = ShellSettings {
            close_to_tray: false,
            autostart: true,
        };
        save(&dir, wanted).expect("save");
        assert_eq!(load(&dir), wanted);

        let text = std::fs::read_to_string(dir.join(SETTINGS_FILE)).expect("read");
        assert!(text.contains("\"closeToTray\": false"), "got {text}");
        assert!(text.contains("\"autostart\": true"), "got {text}");
    }

    #[test]
    fn a_byte_order_mark_does_not_hide_the_settings() {
        let dir = scratch("bom");
        // What PowerShell's `Set-Content -Encoding utf8` and Notepad both write.
        std::fs::write(
            dir.join(SETTINGS_FILE),
            "\u{feff}{\"closeToTray\":false,\"autostart\":true}\r\n",
        )
        .expect("write");
        assert_eq!(
            load(&dir),
            ShellSettings {
                close_to_tray: false,
                autostart: true,
            }
        );
    }

    #[test]
    fn a_partial_or_broken_file_still_opens_the_app() {
        let dir = scratch("broken");
        std::fs::write(dir.join(SETTINGS_FILE), "{\"autostart\":true}").expect("write");
        assert_eq!(
            load(&dir),
            ShellSettings {
                close_to_tray: true,
                autostart: true,
            }
        );

        std::fs::write(dir.join(SETTINGS_FILE), "not json at all").expect("write");
        assert_eq!(load(&dir), ShellSettings::default());
    }

    #[test]
    fn the_store_persists_every_change() {
        let dir = scratch("store");
        let _ = std::fs::remove_file(dir.join(SETTINGS_FILE));

        let store = SettingsStore::open(&dir);
        assert!(store.get().close_to_tray);

        let (updated, error) = store.update(|settings| settings.close_to_tray = false);
        assert!(error.is_none(), "{error:?}");
        assert!(!updated.close_to_tray);
        assert!(!store.get().close_to_tray);
        // A new store sees it, which is what a restart does.
        assert!(!SettingsStore::open(&dir).get().close_to_tray);
    }
}
