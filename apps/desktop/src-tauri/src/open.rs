//! What a stored path may do when it reaches the OS (§13, ruling R102, WP-20b).
//!
//! A resource's path is a string someone typed or picked once, possibly on
//! another PC, and stored. These commands are the only way it reaches Windows,
//! and the page, the backend and the UI's hints have no say: the shell checks
//! the string, then the file it canonicalizes to, and hands the OS that
//! canonical path — never the stored text. A program or script is never
//! opened; it can only be selected in its folder (Show in Explorer), which runs
//! nothing.
//!
//! R43's "a path the user just picked" governs reading or writing contents.
//! Opening and revealing read nothing, so they accept a stored path and rely on
//! these checks instead.

use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::{Duration, Instant};

/// R102: the types that open with their default program.
pub const ALLOWLIST: &[&str] = &[
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "rtf", "txt", "md",
    "csv", "png", "jpg", "jpeg", "gif", "bmp", "webp", "svg", "zip", "mp4",
];

/// R102's named deny list: programs, scripts, shortcuts, disk images, macro documents.
pub const DENYLIST: &[&str] = &[
    "exe",
    "msi",
    "msp",
    "bat",
    "cmd",
    "com",
    "ps1",
    "psm1",
    "psd1",
    "vbs",
    "vbe",
    "js",
    "jse",
    "wsf",
    "wsh",
    "hta",
    "scr",
    "pif",
    "lnk",
    "url",
    "reg",
    "cpl",
    "inf",
    "chm",
    "scf",
    "jar",
    "msc",
    "appx",
    "msix",
    "appxbundle",
    "msixbundle",
    "application",
    "gadget",
    "dll",
    "ocx",
    "sys",
    "iso",
    "img",
    "vhd",
    "vhdx",
    "docm",
    "dotm",
    "xlsm",
    "xltm",
    "pptm",
    "potm",
    "html",
    "htm",
    "mht",
    "py",
    "pyw",
    "sh",
];

/// How long a network path may take to answer before it is UNREACHABLE (R103).
pub const NETWORK_TIMEOUT: Duration = Duration::from_secs(3);

/// Why a path is not opened — the contract's `OpenRefusal`, by the same names.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Refusal {
    NotAbsolute,
    Traversal,
    DevicePath,
    AlternateStream,
    TrailingDotOrSpace,
    ReservedName,
    NotFound,
    IsDirectory,
    BlockedType,
    UnknownType,
}

/// What the string alone allows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    /// A document type: it may open once the file is found.
    Open,
    /// It may be selected in its folder, never opened.
    RevealOnly(Refusal),
    /// It is never passed on at all — not to open, not to reveal.
    Refuse(Refusal),
}

const RESERVED: [&str; 22] = [
    "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8",
    "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
];

fn is_allowed(ext: &str) -> bool {
    ALLOWLIST.contains(&ext)
}

fn is_denied(ext: &str) -> bool {
    DENYLIST.contains(&ext)
}

/// The last extension of a file name, lower-cased; empty when there is none.
fn last_extension(name: &str) -> String {
    match name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() => ext.to_ascii_lowercase(),
        _ => String::new(),
    }
}

/// The type rule alone, for a file name that has passed the string checks.
fn type_decision(name: &str) -> Decision {
    let ext = last_extension(name);
    if is_allowed(&ext) {
        Decision::Open
    } else if is_denied(&ext) {
        Decision::RevealOnly(Refusal::BlockedType)
    } else {
        Decision::RevealOnly(Refusal::UnknownType)
    }
}

/// R102's string checks, in order; touches nothing on disk.
#[must_use]
pub fn classify_path(path: &str) -> Decision {
    let unified = path.replace('/', "\\");
    if unified.starts_with("\\\\?\\") || unified.starts_with("\\\\.\\") {
        return Decision::Refuse(Refusal::DevicePath);
    }
    let bytes = unified.as_bytes();
    let drive =
        bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && bytes[2] == b'\\';
    let unc = unified.starts_with("\\\\")
        && {
            let mut parts = unified[2..].split('\\');
            matches!((parts.next(), parts.next()), (Some(server), Some(share)) if !server.is_empty() && !share.is_empty())
        };
    if !drive && !unc {
        return Decision::Refuse(Refusal::NotAbsolute);
    }
    // After the drive's own colon, a colon names an alternate data stream.
    let rest = &unified[2..];
    if rest.contains(':') {
        return Decision::Refuse(Refusal::AlternateStream);
    }
    let components: Vec<&str> = rest.split('\\').filter(|part| !part.is_empty()).collect();
    if components.contains(&"..") {
        return Decision::Refuse(Refusal::Traversal);
    }
    let Some(last) = components.last() else {
        // `C:\` itself: a folder.
        return Decision::RevealOnly(Refusal::IsDirectory);
    };
    if last.ends_with('.') || last.ends_with(' ') {
        return Decision::Refuse(Refusal::TrailingDotOrSpace);
    }
    let skip = if unc { 2 } else { 0 };
    for part in components.iter().skip(skip) {
        let stem = part.split('.').next().unwrap_or_default().trim_end();
        if RESERVED.contains(&stem.to_ascii_lowercase().as_str()) {
            return Decision::Refuse(Refusal::ReservedName);
        }
    }
    type_decision(last)
}

/// `\\?\C:\x` → `C:\x`, `\\?\UNC\server\share\x` → `\\server\share\x` (R102: hand the OS a plain path).
#[must_use]
pub fn strip_verbatim(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    if let Some(rest) = text.strip_prefix("\\\\?\\UNC\\") {
        PathBuf::from(format!("\\\\{rest}"))
    } else if let Some(rest) = text.strip_prefix("\\\\?\\") {
        PathBuf::from(rest)
    } else {
        path.to_path_buf()
    }
}

/// What the filesystem says about a path; injected so the rules are testable.
pub trait Probe {
    /// The canonical path, or `None` when it does not exist.
    fn canonical(&self, path: &Path) -> Option<PathBuf>;
    fn is_dir(&self, path: &Path) -> bool;
}

/// The real disk.
pub struct Disk;

impl Probe for Disk {
    fn canonical(&self, path: &Path) -> Option<PathBuf> {
        std::fs::canonicalize(path).ok()
    }
    fn is_dir(&self, path: &Path) -> bool {
        path.is_dir()
    }
}

/// Whether `path` may be opened, and the canonical path the OS is handed if so.
pub fn openable(path: &str, probe: &dyn Probe) -> Result<PathBuf, Refusal> {
    let decision = classify_path(path);
    if let Decision::Refuse(reason) = decision {
        return Err(reason);
    }
    // Even a blocked name is looked up, so a missing file says "not found".
    let canonical = probe.canonical(Path::new(path)).ok_or(Refusal::NotFound)?;
    if probe.is_dir(&canonical) {
        return Err(Refusal::IsDirectory);
    }
    if let Decision::RevealOnly(reason) = decision {
        return Err(reason);
    }
    let plain = strip_verbatim(&canonical);
    // The canonical target is judged again: a link named doc.pdf may point at an .exe.
    match classify_path(&plain.to_string_lossy()) {
        Decision::Open => Ok(plain),
        Decision::RevealOnly(reason) | Decision::Refuse(reason) => Err(reason),
    }
}

/// Whether `path` may be selected in its folder, and the canonical path to select.
pub fn revealable(path: &str, probe: &dyn Probe) -> Result<PathBuf, Refusal> {
    if let Decision::Refuse(reason) = classify_path(path) {
        return Err(reason);
    }
    let canonical = probe.canonical(Path::new(path)).ok_or(Refusal::NotFound)?;
    Ok(strip_verbatim(&canonical))
}

/// `open_local_path`: the checks, then the hand-off — which a refusal never reaches.
pub fn open_with(
    path: &str,
    probe: &dyn Probe,
    opener: &dyn Fn(&Path) -> Result<(), String>,
) -> Result<Result<(), Refusal>, String> {
    match openable(path, probe) {
        Ok(target) => opener(&target).map(|()| Ok(())),
        Err(reason) => Ok(Err(reason)),
    }
}

/// `reveal_path`: the checks, then Explorer selecting the item — never running it.
pub fn reveal_with(
    path: &str,
    probe: &dyn Probe,
    revealer: &dyn Fn(&Path) -> Result<(), String>,
) -> Result<Result<(), Refusal>, String> {
    match revealable(path, probe) {
        Ok(target) => revealer(&target).map(|()| Ok(())),
        Err(reason) => Ok(Err(reason)),
    }
}

/// One `stat_paths` answer (the contract's `StatPathsResult.results[]`).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct PathStat {
    pub path: String,
    /// "OK", "MISSING" or "UNREACHABLE".
    pub status: &'static str,
    pub openable: bool,
    pub reason: Option<Refusal>,
}

/// One path's answer: refused strings are reported without being looked up.
pub fn stat_one(path: &str, probe: &dyn Probe) -> PathStat {
    // A refused string is never passed on, not even to look it up.
    if let Decision::Refuse(reason) = classify_path(path) {
        return PathStat {
            path: path.to_owned(),
            status: "MISSING",
            openable: false,
            reason: Some(reason),
        };
    }
    let found = probe.canonical(Path::new(path)).is_some();
    let decision = openable(path, probe);
    PathStat {
        path: path.to_owned(),
        status: if found { "OK" } else { "MISSING" },
        openable: decision.is_ok(),
        reason: decision.err(),
    }
}

/// Every path probed on its own thread; one that has not answered by the
/// deadline (a network share that does not reply) is UNREACHABLE.
#[must_use]
pub fn stat_all(paths: &[String], timeout: Duration) -> Vec<PathStat> {
    stat_all_with(
        paths,
        timeout,
        std::sync::Arc::new(|path: &str| stat_one(path, &Disk)),
    )
}

/// `stat_all` with the probe injected, so the deadline is testable.
pub fn stat_all_with(
    paths: &[String],
    timeout: Duration,
    stat: std::sync::Arc<dyn Fn(&str) -> PathStat + Send + Sync>,
) -> Vec<PathStat> {
    let deadline = Instant::now() + timeout;
    let pending: Vec<_> = paths
        .iter()
        .map(|path| {
            let (sender, receiver) = mpsc::channel();
            let owned = path.clone();
            let stat = std::sync::Arc::clone(&stat);
            // A share that never answers keeps its thread until Windows gives up;
            // the answer is no longer waited for.
            std::thread::spawn(move || {
                let _ = sender.send(stat(&owned));
            });
            (path.clone(), receiver)
        })
        .collect();
    pending
        .into_iter()
        .map(|(path, receiver)| {
            let left = deadline.saturating_duration_since(Instant::now());
            receiver.recv_timeout(left).unwrap_or(PathStat {
                path,
                status: "UNREACHABLE",
                openable: false,
                reason: None,
            })
        })
        .collect()
}

/// This PC's name, as Windows reports it, for "On LAB-PC-07".
#[must_use]
pub fn machine_label() -> String {
    std::env::var("COMPUTERNAME")
        .ok()
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| "This PC".to_owned())
}

/// Selects the item in its parent folder. `/select,` makes Explorer highlight it; nothing is run.
#[cfg(windows)]
pub fn reveal_in_explorer(target: &Path) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    // A Windows path cannot contain `"`, so quoting it is enough.
    std::process::Command::new("explorer.exe")
        .raw_arg(format!("/select,\"{}\"", target.display()))
        .spawn()
        .map(|_| ())
        .map_err(|cause| format!("Explorer did not start: {cause}"))
}

#[cfg(not(windows))]
pub fn reveal_in_explorer(_target: &Path) -> Result<(), String> {
    Err("Show in Explorer is only implemented on Windows.".to_owned())
}

#[cfg(test)]
#[path = "open_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "open_stat_tests.rs"]
mod stat_tests;
