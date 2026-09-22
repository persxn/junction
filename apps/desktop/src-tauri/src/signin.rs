//! The packaged sign-in window (owner ruling R74 / D-34, WP-14).
//!
//! A professor signs in to an approved source — Devfolio, Unstop — with their
//! own account, in a window the app opens for that purpose, and the cookies for
//! that source's domains are handed to the backend to be stored like an API key.
//!
//! Four rules are enforced here rather than trusted, because this window holds
//! somebody's live session:
//!
//! 1. **Its own profile.** The window is given a data directory of its own, so
//!    the site's cookies never enter the WebView the application UI runs in.
//! 2. **Its own hosts.** Navigation anywhere but the source's hosts is refused,
//!    so a link in a page cannot walk the window somewhere else.
//! 3. **Its own cookies.** Only cookies whose domain belongs to the source are
//!    read; everything else the profile happens to hold stays where it is.
//! 4. **Nothing is automated.** The professor types their own password and
//!    solves their own CAPTCHA. The shell opens a window and reads cookies out
//!    of it; it never fills a field and never presses a button.
//!
//! What pre-M2a adds is a way back. WP-14 left the window mute, so the card
//! needed two buttons - one to open it and one to say "I am done" - and the
//! professor had to know that. The window now emits `signin://finished` when it
//! reaches a page past the login form, or when they close it, and the card is
//! one button again.

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Url, WebviewUrl, WebviewWindowBuilder, WindowEvent};

/// One window at a time, whichever source it is for.
pub const WINDOW_LABEL: &str = "source-signin";

/// Where the sign-in window keeps its profile: never the app's own WebView data.
pub const PROFILE_DIR: &str = "signin-profile";

/// Emitted once per sign-in window, when there is something worth reading or
/// the professor has given up. The UI captures on it; nothing is read here.
pub const FINISHED_EVENT: &str = "signin://finished";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignInRequest {
    /// `sources.key`; only used for the window title and the answer.
    pub source_key: String,
    /// The source's own login page, from `config_json.session.loginUrl`.
    pub login_url: String,
    /// `config_json.session.hosts` — the only hosts this window may load.
    pub hosts: Vec<String>,
}

/// The payload of `FINISHED_EVENT`: which source's window is done.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignInFinished {
    pub source_key: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignInResult {
    pub source_key: String,
    /// A `Cookie:` header value, or empty when the professor is not signed in.
    pub cookie: String,
    /// How many cookies were taken, so the UI can say "nothing was found".
    pub count: usize,
}

/// One cookie, reduced to what the filter needs. Keeps the rules testable
/// without a WebView.
#[derive(Debug, Clone)]
pub struct CapturedCookie {
    pub name: String,
    pub value: String,
    /// The cookie's own domain, with or without its leading dot.
    pub domain: Option<String>,
}

/// Whether a host is covered by one of the source's patterns — `devfolio.co`
/// for that host exactly, `*.devfolio.co` for the domain and its sub-domains.
///
/// The same grammar the backend's `allowed_paths_json` uses, so a source's hosts
/// mean one thing in both processes.
#[must_use]
pub fn host_allowed(host: &str, hosts: &[String]) -> bool {
    let target = host.trim_start_matches('.').to_ascii_lowercase();
    hosts.iter().any(|pattern| {
        let wanted = pattern.trim().to_ascii_lowercase();
        if let Some(base) = wanted.strip_prefix("*.") {
            target == base || target.ends_with(&format!(".{base}"))
        } else {
            target == wanted
        }
    })
}

/// Whether the window may load a URL: https, on one of the source's hosts.
#[must_use]
pub fn url_allowed(url: &Url, hosts: &[String]) -> bool {
    if url.scheme() != "https" {
        return false;
    }
    url.host_str().is_some_and(|host| host_allowed(host, hosts))
}

/// The `Cookie:` header for the cookies that belong to this source.
///
/// A cookie with no domain of its own was set by the page that is open, which
/// is one of the source's by rule 2 above; anything else must name a domain the
/// source owns or it is left behind.
#[must_use]
pub fn cookie_header(cookies: &[CapturedCookie], hosts: &[String]) -> String {
    cookies
        .iter()
        .filter(|cookie| match cookie.domain.as_deref() {
            Some(domain) => host_allowed(domain, hosts),
            None => true,
        })
        .map(|cookie| format!("{}={}", cookie.name, cookie.value))
        .collect::<Vec<_>>()
        .join("; ")
}

/// Whether a navigation looks like the professor getting past the login form.
///
/// There is no configured "you are in now" URL, and inventing one per source
/// would be a setting that goes stale the next time a site reorganizes itself.
/// What is true of every login flow is that it ends somewhere that is not the
/// login form: the same host, a different path. A form that posts to itself, a
/// `?next=` round trip and an error reload all stay on the login path, and are
/// not mistaken for success.
#[must_use]
pub fn is_landing(url: &Url, login: &Url, hosts: &[String]) -> bool {
    url_allowed(url, hosts)
        && url.path().trim_end_matches('/') != login.path().trim_end_matches('/')
}

/// The profile directory the sign-in window uses, inside the data directory.
#[must_use]
pub fn profile_dir(data_dir: &std::path::Path) -> PathBuf {
    data_dir.join(PROFILE_DIR)
}

/// Opens (or focuses) the sign-in window for one source.
///
/// The window is an ordinary browser window pointed at the source's login page.
/// Nothing is injected into it and nothing is read from it until it says it is
/// finished - which it does exactly once, whether the professor signed in or
/// closed the window, so the card never waits for an event that is not coming.
pub fn open(
    app: &AppHandle,
    data_dir: &std::path::Path,
    request: &SignInRequest,
) -> Result<(), String> {
    let login = Url::parse(&request.login_url).map_err(|error| error.to_string())?;
    if !url_allowed(&login, &request.hosts) {
        return Err("That sign-in page is not one of this source's own pages.".to_owned());
    }
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(());
    }

    // One notification per window, from whichever of the two things happens
    // first. An `AtomicBool` rather than a lock: both callbacks run on the main
    // thread, but they are separate closures and the flag is all they share.
    let finished = Arc::new(AtomicBool::new(false));
    let announce = {
        let app = app.clone();
        let source_key = request.source_key.clone();
        let finished = Arc::clone(&finished);
        move || {
            if !finished.swap(true, Ordering::SeqCst) {
                let _ = app.emit(
                    FINISHED_EVENT,
                    SignInFinished {
                        source_key: source_key.clone(),
                    },
                );
            }
        }
    };

    let hosts = request.hosts.clone();
    let on_landing = announce.clone();
    let window = WebviewWindowBuilder::new(app, WINDOW_LABEL, WebviewUrl::External(login.clone()))
        .title(format!("Sign in to {}", request.source_key))
        .inner_size(1000.0, 800.0)
        // Rule 1: its own profile, never the application WebView's.
        .data_directory(profile_dir(data_dir))
        // Rule 2: the source's hosts and nothing else - and, on the way past the
        // login form, the one event the card is waiting for.
        .on_navigation(move |url| {
            if !url_allowed(url, &hosts) {
                return false;
            }
            if is_landing(url, &login, &hosts) {
                on_landing();
            }
            true
        })
        .build()
        .map_err(|error| error.to_string())?;

    // ...and if they close it instead, that is an answer too. The UI asks for
    // the cookies either way; an empty capture is how "not signed in" is said.
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Destroyed) {
            announce();
        }
    });
    Ok(())
}

/// Reads the source's cookies out of the sign-in window and closes it.
pub fn capture(app: &AppHandle, request: &SignInRequest) -> Result<SignInResult, String> {
    let window = app
        .get_webview_window(WINDOW_LABEL)
        .ok_or_else(|| "The sign-in window is not open.".to_owned())?;
    let url = Url::parse(&request.login_url).map_err(|error| error.to_string())?;
    let captured: Vec<CapturedCookie> = window
        .cookies_for_url(url)
        .map_err(|error| error.to_string())?
        .into_iter()
        .map(|cookie| CapturedCookie {
            name: cookie.name().to_owned(),
            value: cookie.value().to_owned(),
            domain: cookie.domain().map(str::to_owned),
        })
        .collect();
    let cookie = cookie_header(&captured, &request.hosts);
    let count = captured.len();
    window.close().map_err(|error| error.to_string())?;
    Ok(SignInResult {
        source_key: request.source_key.clone(),
        cookie,
        count,
    })
}

/// Closes the window without reading anything (the professor changed their mind).
pub fn close(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        let _ = window.close();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hosts() -> Vec<String> {
        vec!["devfolio.co".to_owned(), "*.devfolio.co".to_owned()]
    }

    #[test]
    fn a_plain_entry_matches_that_host_exactly() {
        assert!(host_allowed("devfolio.co", &hosts()));
        assert!(!host_allowed("devfolio.co.evil.test", &hosts()));
        assert!(!host_allowed("notdevfolio.co", &hosts()));
    }

    #[test]
    fn a_wildcard_matches_the_domain_and_its_subdomains() {
        assert!(host_allowed("codestorm.devfolio.co", &hosts()));
        assert!(host_allowed(".devfolio.co", &hosts()));
        assert!(!host_allowed("devfolio.co.example.com", &hosts()));
    }

    #[test]
    fn only_https_pages_on_the_sources_own_hosts_may_be_loaded() {
        let allowed = Url::parse("https://devfolio.co/login").unwrap();
        let other_host = Url::parse("https://accounts.google.com/signin").unwrap();
        let insecure = Url::parse("http://devfolio.co/login").unwrap();
        assert!(url_allowed(&allowed, &hosts()));
        assert!(!url_allowed(&other_host, &hosts()));
        assert!(!url_allowed(&insecure, &hosts()));
    }

    #[test]
    fn only_the_sources_own_cookies_are_taken() {
        let cookies = vec![
            CapturedCookie {
                name: "df_session".to_owned(),
                value: "abc".to_owned(),
                domain: Some(".devfolio.co".to_owned()),
            },
            CapturedCookie {
                name: "ga".to_owned(),
                value: "trackme".to_owned(),
                domain: Some(".google-analytics.com".to_owned()),
            },
            CapturedCookie {
                name: "page_set".to_owned(),
                value: "1".to_owned(),
                domain: None,
            },
        ];
        let header = cookie_header(&cookies, &hosts());
        assert_eq!(header, "df_session=abc; page_set=1");
        assert!(!header.contains("trackme"));
    }

    #[test]
    fn an_empty_capture_is_an_empty_header_rather_than_a_lie() {
        assert_eq!(cookie_header(&[], &hosts()), "");
    }

    #[test]
    fn getting_past_the_login_form_is_what_counts_as_finished() {
        let login = Url::parse("https://devfolio.co/login").unwrap();
        for landed in [
            "https://devfolio.co/dashboard",
            "https://devfolio.co/",
            "https://codestorm.devfolio.co/overview",
        ] {
            let url = Url::parse(landed).unwrap();
            assert!(
                is_landing(&url, &login, &hosts()),
                "{landed} is past the form"
            );
        }
        // The form posting to itself, a round trip and a trailing slash are not.
        for still_signing_in in [
            "https://devfolio.co/login",
            "https://devfolio.co/login?next=%2Fdashboard",
            "https://devfolio.co/login/",
            "https://devfolio.co/login#error",
        ] {
            let url = Url::parse(still_signing_in).unwrap();
            assert!(
                !is_landing(&url, &login, &hosts()),
                "{still_signing_in} is still the form"
            );
        }
        // Somewhere else entirely is refused by rule 2 before this is asked.
        let elsewhere = Url::parse("https://accounts.google.com/x").unwrap();
        assert!(!is_landing(&elsewhere, &login, &hosts()));
    }

    #[test]
    fn the_profile_never_shares_the_apps_own_webview_data() {
        let dir = profile_dir(std::path::Path::new("C:\\data"));
        assert!(dir.ends_with(PROFILE_DIR));
        assert_ne!(dir, std::path::Path::new("C:\\data"));
    }
}
