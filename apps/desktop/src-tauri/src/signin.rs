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

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder};

/// One window at a time, whichever source it is for.
pub const WINDOW_LABEL: &str = "source-signin";

/// Where the sign-in window keeps its profile: never the app's own WebView data.
pub const PROFILE_DIR: &str = "signin-profile";

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

/// The profile directory the sign-in window uses, inside the data directory.
#[must_use]
pub fn profile_dir(data_dir: &std::path::Path) -> PathBuf {
    data_dir.join(PROFILE_DIR)
}

/// Opens (or focuses) the sign-in window for one source.
///
/// The window is an ordinary browser window pointed at the source's login page.
/// Nothing is injected into it and nothing is read from it until the professor
/// says they are signed in.
pub fn open(
    app: &AppHandle,
    data_dir: &std::path::Path,
    request: &SignInRequest,
) -> Result<(), String> {
    let url = Url::parse(&request.login_url).map_err(|error| error.to_string())?;
    if !url_allowed(&url, &request.hosts) {
        return Err("That sign-in page is not one of this source's own pages.".to_owned());
    }
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(());
    }
    let hosts = request.hosts.clone();
    WebviewWindowBuilder::new(app, WINDOW_LABEL, WebviewUrl::External(url))
        .title(format!("Sign in to {}", request.source_key))
        .inner_size(1000.0, 800.0)
        // Rule 1: its own profile, never the application WebView's.
        .data_directory(profile_dir(data_dir))
        // Rule 2: the source's hosts and nothing else.
        .on_navigation(move |url| url_allowed(url, &hosts))
        .build()
        .map(|_| ())
        .map_err(|error| error.to_string())
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
    fn the_profile_never_shares_the_apps_own_webview_data() {
        let dir = profile_dir(std::path::Path::new("C:\\data"));
        assert!(dir.ends_with(PROFILE_DIR));
        assert_ne!(dir, std::path::Path::new("C:\\data"));
    }
}
