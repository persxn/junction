//! Handing a link to the default browser (§13 "Opening safely", ruling R78).
//!
//! The page cannot do this itself. `window.open` inside WebView2 is refused in
//! the packaged app, so "Open registration" looked like a button that does
//! nothing — M1 fault 2. The shell opens the link instead, which is exactly what
//! §3.2 rule 2 allows IPC for.
//!
//! What may be opened is narrow on purpose. Every URL here came from a scraped
//! page or a typed field, so it is untrusted input being handed to the shell of
//! the operating system. §13 fixes the kinds: http and https for a link, and
//! `mailto:` for an organizer's address. Everything else — `file:`, a UNC path,
//! `javascript:`, `ms-settings:`, any other scheme a Windows handler has claimed
//! — is a stored string being allowed to start a program, which is the thing
//! §13 exists to prevent.

use tauri::Url;

/// The three schemes §13 allows.
pub const ALLOWED_SCHEMES: [&str; 3] = ["http", "https", "mailto"];

/// Why a URL was not opened. The page shows the URL to copy instead.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OpenRefusal {
    Unparseable,
    Scheme(String),
    Credentials,
    NoHost,
}

impl OpenRefusal {
    #[must_use]
    pub fn message(&self) -> String {
        match self {
            Self::Unparseable => "That is not a URL CompIntel can open.".to_owned(),
            Self::Scheme(scheme) => {
                format!("CompIntel opens web and email links only, not {scheme}: links.")
            }
            Self::Credentials => {
                "That link carries a user name and password, so it is not opened.".to_owned()
            }
            Self::NoHost => "That web link names no site, so it is not opened.".to_owned(),
        }
    }
}

/// Whether the shell will hand this URL to the default browser.
///
/// A `http://user:password@host/` URL is refused even though its scheme is
/// allowed: the credentials are carried to whatever the host really is, and a
/// scraped link is not a place to learn that the hard way.
pub fn authorise(url: &str) -> Result<Url, OpenRefusal> {
    let parsed = Url::parse(url.trim()).map_err(|_| OpenRefusal::Unparseable)?;
    let scheme = parsed.scheme().to_ascii_lowercase();
    if !ALLOWED_SCHEMES.contains(&scheme.as_str()) {
        return Err(OpenRefusal::Scheme(scheme));
    }
    if scheme != "mailto" {
        if !parsed.username().is_empty() || parsed.password().is_some() {
            return Err(OpenRefusal::Credentials);
        }
        if parsed.host_str().unwrap_or_default().is_empty() {
            return Err(OpenRefusal::NoHost);
        }
    }
    Ok(parsed)
}

/// Opens an authorised URL with whatever Windows has registered for it.
///
/// `ShellExecuteW` with a verb of `open` is what the Explorer address bar does.
/// It is reached through the `windows` crate the Job Object already uses, so
/// §13's one sentence costs no new dependency.
#[cfg(windows)]
fn launch(url: &Url) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;

    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
    use windows::core::PCWSTR;

    fn wide(value: &str) -> Vec<u16> {
        std::ffi::OsStr::new(value)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    let verb = wide("open");
    let target = wide(url.as_str());
    // SAFETY: both strings are NUL-terminated and outlive the call, and every
    // other argument is null, which ShellExecuteW documents as "no value".
    let result = unsafe {
        ShellExecuteW(
            None,
            PCWSTR(verb.as_ptr()),
            PCWSTR(target.as_ptr()),
            PCWSTR::null(),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };
    // Its historical return: a "HINSTANCE" that is an error code at or below 32.
    if result.0 as isize > 32 {
        Ok(())
    } else {
        Err(format!(
            "Windows would not open that link (error {}).",
            result.0 as isize
        ))
    }
}

#[cfg(not(windows))]
fn launch(_url: &Url) -> Result<(), String> {
    Err("Opening a link is only implemented on Windows.".to_owned())
}

/// §13's "URLs open in the default browser", with the rules above applied first.
pub fn open(url: &str) -> Result<(), String> {
    let authorised = authorise(url).map_err(|refusal| refusal.message())?;
    launch(&authorised)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_three_kinds_of_link_the_spec_allows_are_opened() {
        for url in [
            "https://devfolio.co/hackathon/x",
            "http://127.0.0.1:52991/api/v1/health",
            "mailto:professor@example.edu",
            "mailto:professor@example.edu?subject=Hi",
        ] {
            assert!(authorise(url).is_ok(), "{url} should be allowed");
        }
        // Whitespace around a pasted link is not a reason to refuse it.
        assert!(authorise("  https://ctftime.org/event/1  ").is_ok());
    }

    #[test]
    fn a_scheme_that_could_start_a_program_is_refused() {
        for (url, scheme) in [
            ("file:///C:/Windows/System32/calc.exe", "file"),
            ("javascript:alert(1)", "javascript"),
            ("ms-settings:windowsupdate", "ms-settings"),
            ("vbscript:msgbox", "vbscript"),
            ("data:text/html,<script>", "data"),
            ("ftp://files.example.com/x", "ftp"),
        ] {
            assert_eq!(
                authorise(url),
                Err(OpenRefusal::Scheme(scheme.to_owned())),
                "{url} should be refused"
            );
        }
    }

    #[test]
    fn a_unc_path_is_not_a_url_this_will_open() {
        // `\\server\share\x` parses as nothing at all; `file://server/share` is
        // the same path wearing a scheme, and is refused for being one.
        assert_eq!(
            authorise("\\\\server\\share\\payload.exe"),
            Err(OpenRefusal::Unparseable)
        );
        assert_eq!(
            authorise("file://server/share/payload.exe"),
            Err(OpenRefusal::Scheme("file".to_owned()))
        );
        assert_eq!(authorise(""), Err(OpenRefusal::Unparseable));
        assert_eq!(authorise("not a url"), Err(OpenRefusal::Unparseable));
    }

    #[test]
    fn a_web_link_carrying_credentials_is_refused() {
        for url in [
            "http://admin:hunter2@intranet.example.com/",
            "https://admin@evil.test/",
            "https://user:@evil.test/",
        ] {
            assert_eq!(
                authorise(url),
                Err(OpenRefusal::Credentials),
                "{url} should be refused"
            );
        }
    }

    #[test]
    fn a_refusal_says_what_to_do_instead_of_nothing() {
        assert!(
            OpenRefusal::Scheme("file".to_owned())
                .message()
                .contains("file:")
        );
        assert!(!OpenRefusal::Credentials.message().is_empty());
        assert!(!OpenRefusal::NoHost.message().is_empty());
        assert!(!OpenRefusal::Unparseable.message().is_empty());
    }
}
