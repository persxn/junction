//! Notifications outside the window (R90, R24, R19, WP-23): the tray's count
//! badge and tooltip, and Windows toasts for CRITICAL notifications. The UI
//! owns the count and decides what is critical (the WebView stays alive while
//! the window is closed to the tray); the shell only draws and shows.
//!
//! Debug builds toast under the PowerShell AUMID: there is no Start-menu
//! shortcut with our own AppUserModelID until the installer (WP-31) registers
//! one, so toasts read "Windows PowerShell" and a click after the toast has
//! moved to Action Center may open PowerShell rather than CompIntel.

use serde::Deserialize;
use tauri::image::Image;
use tauri::{AppHandle, Emitter};

use crate::actions;
use crate::badge::{Badge, draw_badge, tooltip, tray_badge};
use crate::tray::TRAY_ID;

/// `contracts/src/shell.ts` `NAVIGATE_EVENT`.
pub const NAVIGATE_EVENT: &str = "app://navigate";

/// `contracts/src/shell.ts` `CriticalToast`.
#[derive(Debug, Clone, Deserialize)]
pub struct CriticalToast {
    pub id: String,
    pub title: String,
    pub body: String,
    pub route: String,
}

/// One of the app's own paths, "/competitions/<id>" - never a URL, a
/// protocol-relative "//host", or anything with a query or a scheme.
pub fn is_internal_route(route: &str) -> bool {
    let mut chars = route.chars();
    chars.next() == Some('/')
        && !route.starts_with("//")
        && route.len() <= 200
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '_' | '-'))
}

/// What a toast's click does, apart from Tauri, so it can be tested.
pub trait Activation {
    fn show(&self);
    fn navigate(&self, route: &str);
}

/// Bring the window back and, if the route is ours, go there.
pub fn activate(target: &impl Activation, route: &str) {
    target.show();
    if is_internal_route(route) {
        target.navigate(route);
    }
}

struct AppActivation(AppHandle);

impl Activation for AppActivation {
    fn show(&self) {
        actions::show_window(&self.0);
    }
    fn navigate(&self, route: &str) {
        let _ = self.0.emit(NAVIGATE_EVENT, route);
    }
}

/// The base icon with the badge drawn on, or the base icon itself.
fn badged_icon(base: &Image<'_>, badge: &Badge) -> Image<'static> {
    let mut rgba = base.rgba().to_vec();
    if let Badge::Count(text) = badge {
        draw_badge(&mut rgba, base.width(), base.height(), text);
    }
    Image::new_owned(rgba, base.width(), base.height())
}

/// The UI's unread count: redraw the tray icon and its tooltip.
#[tauri::command]
pub fn tray_set_unread(app: AppHandle, count: u32) -> Result<(), String> {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return Ok(());
    };
    let Some(base) = app.default_window_icon() else {
        return Ok(());
    };
    // R90: health beats count; health is always None until WP-30.
    let badge = tray_badge(None, count);
    tray.set_icon(Some(badged_icon(base, &badge)))
        .map_err(|error| error.to_string())?;
    tray.set_tooltip(Some(tooltip(count)))
        .map_err(|error| error.to_string())
}

/// A CRITICAL notification the person wants toasted (R110).
#[tauri::command]
pub fn notify_critical(app: AppHandle, toast: CriticalToast) -> Result<(), String> {
    if !is_internal_route(&toast.route) {
        return Err("a notification can only open a page inside CompIntel".to_owned());
    }
    show_toast(app, toast)
}

#[cfg(windows)]
fn show_toast(app: AppHandle, toast: CriticalToast) -> Result<(), String> {
    use tauri_winrt_notification::{Duration, Toast};

    let route = toast.route.clone();
    Toast::new(Toast::POWERSHELL_APP_ID)
        .title(&toast.title)
        .text1(&toast.body)
        .duration(Duration::Long)
        .on_activated(move |_| {
            activate(&AppActivation(app.clone()), &route);
            Ok(())
        })
        .show()
        .map_err(|error| error.to_string())
}

#[cfg(not(windows))]
fn show_toast(_app: AppHandle, _toast: CriticalToast) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    #[derive(Default)]
    struct Fake {
        log: RefCell<Vec<String>>,
    }

    impl Activation for Fake {
        fn show(&self) {
            self.log.borrow_mut().push("show".to_owned());
        }
        fn navigate(&self, route: &str) {
            self.log.borrow_mut().push(format!("navigate {route}"));
        }
    }

    #[test]
    fn only_internal_routes_pass() {
        for good in [
            "/competitions/0192f0c1",
            "/discover/event/abc-1",
            "/admin/sources",
            "/",
        ] {
            assert!(is_internal_route(good), "{good}");
        }
        for bad in [
            "",
            "competitions",
            "//evil.example",
            "https://evil.example",
            "javascript:alert(1)",
            "/a?b=c",
            "/a#b",
            "/a b",
            "/\u{e9}",
        ] {
            assert!(!is_internal_route(bad), "{bad}");
        }
        assert!(!is_internal_route(&format!("/{}", "a".repeat(250))));
    }

    #[test]
    fn a_click_shows_the_window_then_navigates() {
        let fake = Fake::default();
        activate(&fake, "/competitions/abc");
        assert_eq!(*fake.log.borrow(), ["show", "navigate /competitions/abc"]);
    }

    #[test]
    fn a_click_with_a_foreign_route_only_shows_the_window() {
        let fake = Fake::default();
        activate(&fake, "https://evil.example");
        assert_eq!(*fake.log.borrow(), ["show"]);
    }

    #[test]
    fn the_toast_dto_reads_the_contract_shape() {
        let toast: CriticalToast = serde_json::from_str(
            r#"{"id":"n1","title":"Book the lab is due today","body":"Team Rocket","route":"/competitions/c1"}"#,
        )
        .unwrap();
        assert_eq!(toast.route, "/competitions/c1");
        assert_eq!(toast.id, "n1");
    }

    #[test]
    fn the_badged_icon_keeps_the_size_and_draws_only_with_a_count() {
        let base = Image::new_owned(vec![0u8; 32 * 32 * 4], 32, 32);
        let plain = badged_icon(&base, &Badge::None);
        assert!(plain.rgba().iter().all(|b| *b == 0));
        let counted = badged_icon(&base, &Badge::Count("3".to_owned()));
        assert_eq!((counted.width(), counted.height()), (32, 32));
        assert!(counted.rgba().iter().any(|b| *b != 0));
    }
}
