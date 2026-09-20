//! The tray icon and its menu (§4.1, D-14). The tray is what makes closing the
//! window safe: the backend keeps scraping, and the only thing that stops
//! everything is "Exit completely".

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};

use crate::actions;
use crate::settings::ShellSettings;

/// Menu item ids. They are also the strings the menu event carries, so they are
/// part of the shell's internal contract and are asserted on in the tests.
pub const ID_SHOW: &str = "tray:show";
pub const ID_CLOSE_TO_TRAY: &str = "tray:close-to-tray";
pub const ID_AUTOSTART: &str = "tray:autostart";
pub const ID_LOGS: &str = "tray:logs";
pub const ID_EXIT: &str = "tray:exit";

/// Id of the tray icon itself, for `app.tray_by_id`.
pub const TRAY_ID: &str = "main";

/// What a click on the menu means.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrayAction {
    Show,
    ToggleCloseToTray,
    ToggleAutostart,
    OpenLogs,
    Exit,
}

impl TrayAction {
    /// Maps a menu event id to an action, or `None` for anything unrecognised -
    /// kept separate from the Tauri plumbing so it can be tested on its own.
    pub fn from_id(id: &str) -> Option<Self> {
        match id {
            ID_SHOW => Some(Self::Show),
            ID_CLOSE_TO_TRAY => Some(Self::ToggleCloseToTray),
            ID_AUTOSTART => Some(Self::ToggleAutostart),
            ID_LOGS => Some(Self::OpenLogs),
            ID_EXIT => Some(Self::Exit),
            _ => None,
        }
    }
}

/// The two check items, kept so the tray can be re-ticked when the same settings
/// are changed from the UI instead of the menu.
pub struct TrayHandles {
    close_to_tray: CheckMenuItem<Wry>,
    autostart: CheckMenuItem<Wry>,
}

impl TrayHandles {
    /// Makes the menu agree with the settings.
    pub fn sync(&self, settings: ShellSettings) {
        let _ = self.close_to_tray.set_checked(settings.close_to_tray);
        let _ = self.autostart.set_checked(settings.autostart);
    }
}

/// Builds the tray icon and its menu. Returns the check items so the UI can keep
/// them in step.
pub fn build(app: &AppHandle, settings: ShellSettings) -> tauri::Result<TrayHandles> {
    let show = MenuItem::with_id(app, ID_SHOW, "Open CompIntel", true, None::<&str>)?;
    let close_to_tray = CheckMenuItem::with_id(
        app,
        ID_CLOSE_TO_TRAY,
        "Close to tray",
        true,
        settings.close_to_tray,
        None::<&str>,
    )?;
    let autostart = CheckMenuItem::with_id(
        app,
        ID_AUTOSTART,
        "Start with Windows",
        true,
        settings.autostart,
        None::<&str>,
    )?;
    let logs = MenuItem::with_id(app, ID_LOGS, "Open logs", true, None::<&str>)?;
    let exit = MenuItem::with_id(app, ID_EXIT, "Exit completely", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &show,
            &PredefinedMenuItem::separator(app)?,
            &close_to_tray,
            &autostart,
            &PredefinedMenuItem::separator(app)?,
            &logs,
            &exit,
        ],
    )?;

    let icon = app.default_window_icon().cloned().ok_or_else(|| {
        tauri::Error::InvalidIcon(std::io::Error::other("no bundled window icon"))
    })?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("CompIntel")
        // Windows convention: left click opens the app, right click the menu.
        .show_menu_on_left_click(false)
        .menu(&menu)
        .on_menu_event(|app, event| {
            dispatch(app, TrayAction::from_id(event.id.as_ref()));
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                actions::show_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(TrayHandles {
        close_to_tray,
        autostart,
    })
}

/// Runs an action, ignoring an id the menu does not own.
fn dispatch(app: &AppHandle, action: Option<TrayAction>) {
    let Some(action) = action else {
        return;
    };
    match action {
        TrayAction::Show => actions::show_window(app),
        TrayAction::ToggleCloseToTray => toggle(app, |settings| !settings.close_to_tray, true),
        TrayAction::ToggleAutostart => toggle(app, |settings| !settings.autostart, false),
        TrayAction::OpenLogs => {
            let _ = actions::open_logs(app);
        }
        TrayAction::Exit => actions::exit_completely(app),
    }
}

/// Flips one of the two check items. `close_to_tray` picks which one, so the two
/// arms stay one line each above.
fn toggle(app: &AppHandle, next: impl FnOnce(ShellSettings) -> bool, close_to_tray: bool) {
    let Some(state) = app.try_state::<crate::commands::ShellState>() else {
        return;
    };
    let wanted = next(state.settings.get());
    let result = if close_to_tray {
        actions::set_close_to_tray(app, wanted)
    } else {
        actions::set_autostart(app, wanted)
    };
    if result.is_err() {
        // The setting could not be applied; put the tick back where it was.
        state.sync_tray(state.settings.get());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_menu_id_maps_to_its_action() {
        assert_eq!(TrayAction::from_id(ID_SHOW), Some(TrayAction::Show));
        assert_eq!(
            TrayAction::from_id(ID_CLOSE_TO_TRAY),
            Some(TrayAction::ToggleCloseToTray)
        );
        assert_eq!(
            TrayAction::from_id(ID_AUTOSTART),
            Some(TrayAction::ToggleAutostart)
        );
        assert_eq!(TrayAction::from_id(ID_LOGS), Some(TrayAction::OpenLogs));
        assert_eq!(TrayAction::from_id(ID_EXIT), Some(TrayAction::Exit));
    }

    #[test]
    fn an_unknown_id_does_nothing() {
        assert_eq!(TrayAction::from_id("tray:nope"), None);
        assert_eq!(TrayAction::from_id(""), None);
    }

    #[test]
    fn the_ids_are_distinct() {
        let ids = [ID_SHOW, ID_CLOSE_TO_TRAY, ID_AUTOSTART, ID_LOGS, ID_EXIT];
        let unique: std::collections::HashSet<&&str> = ids.iter().collect();
        assert_eq!(unique.len(), ids.len());
    }
}
