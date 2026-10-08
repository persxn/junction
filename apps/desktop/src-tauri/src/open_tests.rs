//! The §19 acceptance "executables can't be opened" (ruling R102, WP-20b).
//!
//! The string rules are tested on their own; the filesystem rules on real
//! files in a fresh temporary folder; and the commands' hand-off with an
//! injected opener that must never be called for a refused path.

use std::cell::Cell;
use std::path::{Path, PathBuf};

use super::*;

/// A fresh folder under the system temporary directory, removed on drop.
pub(super) struct Scratch(pub(super) PathBuf);

impl Scratch {
    pub(super) fn new(name: &str) -> Self {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |elapsed| elapsed.as_nanos());
        let dir = std::env::temp_dir().join(format!(
            "compintel-open-{name}-{}-{nanos}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).expect("temp folder");
        Self(dir)
    }

    pub(super) fn file(&self, name: &str) -> String {
        let path = self.0.join(name);
        std::fs::write(&path, b"synthetic").expect("temp file");
        path.to_string_lossy().into_owned()
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn mixed_case(ext: &str) -> String {
    ext.chars()
        .enumerate()
        .map(|(index, ch)| {
            if index % 2 == 0 {
                ch.to_ascii_uppercase()
            } else {
                ch
            }
        })
        .collect()
}

#[test]
fn every_deny_list_extension_is_refused_in_any_case() {
    for ext in DENYLIST {
        for variant in [ext.to_string(), ext.to_ascii_uppercase(), mixed_case(ext)] {
            let path = format!("C:\\Team\\report.{variant}");
            assert_eq!(
                classify_path(&path),
                Decision::RevealOnly(Refusal::BlockedType),
                "{path} must not open"
            );
        }
    }
    assert_eq!(
        classify_path("C:\\Team\\REPORT.EXE"),
        Decision::RevealOnly(Refusal::BlockedType)
    );
}

#[test]
fn only_the_last_extension_counts() {
    assert_eq!(
        classify_path("C:\\Team\\report.pdf.exe"),
        Decision::RevealOnly(Refusal::BlockedType)
    );
    assert_eq!(classify_path("C:\\Team\\report.exe.pdf"), Decision::Open);
}

#[test]
fn a_trailing_dot_or_space_is_refused() {
    for path in [
        "C:\\Team\\report.exe.",
        "C:\\Team\\report.exe ",
        "C:\\Team\\report.pdf.",
        "C:\\Team\\report.pdf ",
    ] {
        assert_eq!(
            classify_path(path),
            Decision::Refuse(Refusal::TrailingDotOrSpace),
            "{path:?}"
        );
    }
}

#[test]
fn alternate_data_streams_are_refused() {
    for path in [
        "C:\\Team\\file.pdf:evil.exe",
        "C:\\Team\\file.pdf::$DATA",
        "\\\\nas\\share\\file.pdf:evil.exe",
    ] {
        assert_eq!(
            classify_path(path),
            Decision::Refuse(Refusal::AlternateStream),
            "{path}"
        );
    }
    // Without a drive it is not even absolute.
    assert_eq!(
        classify_path("file.pdf:evil.exe"),
        Decision::Refuse(Refusal::NotAbsolute)
    );
}

#[test]
fn traversal_is_refused() {
    for path in [
        "C:\\docs\\..\\x.pdf",
        "C:/docs/../x.pdf",
        "\\\\nas\\share\\..\\..\\Windows\\notepad.exe",
    ] {
        assert_eq!(
            classify_path(path),
            Decision::Refuse(Refusal::Traversal),
            "{path}"
        );
    }
    assert_eq!(
        classify_path("..\\..\\Windows\\notepad.exe"),
        Decision::Refuse(Refusal::NotAbsolute)
    );
}

#[test]
fn device_paths_are_refused() {
    for path in [
        "\\\\?\\C:\\x.exe",
        "\\\\?\\C:\\x.pdf",
        "\\\\.\\PhysicalDrive0",
        "//./PhysicalDrive0",
    ] {
        assert_eq!(
            classify_path(path),
            Decision::Refuse(Refusal::DevicePath),
            "{path}"
        );
    }
}

#[test]
fn reserved_device_names_are_refused() {
    for path in [
        "C:\\Team\\CON.pdf",
        "C:\\Team\\nul.txt",
        "C:\\Team\\com1.docx",
        "C:\\LPT9\\x.pdf",
        "C:\\Team\\Aux .pdf",
    ] {
        assert_eq!(
            classify_path(path),
            Decision::Refuse(Refusal::ReservedName),
            "{path}"
        );
    }
    // A name that merely starts like one is fine.
    assert_eq!(classify_path("C:\\Team\\console.pdf"), Decision::Open);
}

#[test]
fn relative_paths_and_bare_names_are_refused() {
    for path in ["x.pdf", "Team\\x.pdf", "\\Team\\x.pdf", "\\\\server", ""] {
        assert_eq!(
            classify_path(path),
            Decision::Refuse(Refusal::NotAbsolute),
            "{path:?}"
        );
    }
}

#[test]
fn no_extension_or_an_unknown_one_is_reveal_only() {
    assert_eq!(
        classify_path("C:\\Team\\README"),
        Decision::RevealOnly(Refusal::UnknownType)
    );
    assert_eq!(
        classify_path("C:\\Team\\model.onnx"),
        Decision::RevealOnly(Refusal::UnknownType)
    );
    assert_eq!(
        classify_path("C:\\Team\\.pdf"),
        Decision::RevealOnly(Refusal::UnknownType)
    );
}

#[test]
fn every_allowlisted_type_opens_when_the_file_exists() {
    let scratch = Scratch::new("allow");
    for ext in ALLOWLIST {
        let path = scratch.file(&format!("brief.{ext}"));
        let opened = openable(&path, &Disk).unwrap_or_else(|reason| panic!("{path}: {reason:?}"));
        // The OS is handed the canonical path, without its `\\?\` prefix.
        assert!(
            !opened.to_string_lossy().starts_with("\\\\?\\"),
            "{opened:?}"
        );
        assert!(opened.is_absolute());
    }
    // Upper case opens too.
    assert!(openable(&scratch.file("SLIDES.PPTX"), &Disk).is_ok());
}

#[test]
fn a_directory_is_reveal_only_and_a_missing_file_is_not_found() {
    let scratch = Scratch::new("dir");
    let folder = scratch.0.join("Shared");
    std::fs::create_dir_all(&folder).expect("folder");
    let folder = folder.to_string_lossy().into_owned();
    assert_eq!(openable(&folder, &Disk), Err(Refusal::IsDirectory));
    assert!(revealable(&folder, &Disk).is_ok());
    let missing = scratch.0.join("gone.pdf").to_string_lossy().into_owned();
    assert_eq!(openable(&missing, &Disk), Err(Refusal::NotFound));
    assert_eq!(revealable(&missing, &Disk), Err(Refusal::NotFound));
    // A real program file exists but is still only revealed.
    let exe = scratch.file("setup.exe");
    assert_eq!(openable(&exe, &Disk), Err(Refusal::BlockedType));
    assert!(revealable(&exe, &Disk).is_ok());
}

#[cfg(windows)]
#[test]
fn a_link_named_like_a_document_is_judged_by_its_target() {
    let scratch = Scratch::new("link");
    let target = scratch.file("payload.exe");
    let link = scratch.0.join("doc.pdf");
    if let Err(cause) = std::os::windows::fs::symlink_file(&target, &link) {
        // Creating a symbolic link needs Developer Mode or an elevated token.
        println!("note: skipped — Windows refused to create a symbolic link ({cause})");
        return;
    }
    let link = link.to_string_lossy().into_owned();
    assert_eq!(
        classify_path(&link),
        Decision::Open,
        "the name alone looks fine"
    );
    assert_eq!(openable(&link, &Disk), Err(Refusal::BlockedType));
}

/// A disk where every path canonicalizes to one fixed target.
struct PointsAt(&'static str);

impl Probe for PointsAt {
    fn canonical(&self, _path: &Path) -> Option<PathBuf> {
        Some(PathBuf::from(self.0))
    }
    fn is_dir(&self, _path: &Path) -> bool {
        false
    }
}

#[test]
fn the_canonical_target_decides_even_without_a_real_link() {
    // What a symbolic link or a junction does, without needing the privilege to make one.
    let probe = PointsAt("\\\\?\\C:\\Temp\\payload.exe");
    assert_eq!(
        openable("C:\\Team\\doc.pdf", &probe),
        Err(Refusal::BlockedType)
    );
    let probe = PointsAt("\\\\?\\C:\\Temp\\brief.pdf");
    assert_eq!(
        openable("C:\\Team\\doc.pdf", &probe),
        Ok(PathBuf::from("C:\\Temp\\brief.pdf"))
    );
}

#[test]
fn a_refused_path_never_reaches_the_opener() {
    let scratch = Scratch::new("handoff");
    let exe = scratch.file("tool.exe");
    let pdf = scratch.file("brief.pdf");
    let calls = Cell::new(0);
    let opener = |_: &Path| -> Result<(), String> {
        calls.set(calls.get() + 1);
        Ok(())
    };
    for (path, reason) in [
        (exe.as_str(), Refusal::BlockedType),
        ("C:\\docs\\..\\x.pdf", Refusal::Traversal),
        ("\\\\?\\C:\\x.exe", Refusal::DevicePath),
        ("x.pdf", Refusal::NotAbsolute),
    ] {
        assert_eq!(open_with(path, &Disk, &opener), Ok(Err(reason)), "{path}");
    }
    assert_eq!(calls.get(), 0, "no refused path may reach the OS");
    assert_eq!(open_with(&pdf, &Disk, &opener), Ok(Ok(())));
    assert_eq!(calls.get(), 1);
}

#[test]
fn reveal_selects_a_program_but_never_passes_on_a_refused_string() {
    let scratch = Scratch::new("reveal");
    let exe = scratch.file("tool.exe");
    let seen = std::cell::RefCell::new(Vec::<PathBuf>::new());
    let revealer = |path: &Path| -> Result<(), String> {
        seen.borrow_mut().push(path.to_path_buf());
        Ok(())
    };
    assert_eq!(reveal_with(&exe, &Disk, &revealer), Ok(Ok(())));
    assert_eq!(
        reveal_with("\\\\.\\PhysicalDrive0", &Disk, &revealer),
        Ok(Err(Refusal::DevicePath))
    );
    assert_eq!(
        reveal_with("C:\\Team\\CON.pdf", &Disk, &revealer),
        Ok(Err(Refusal::ReservedName))
    );
    let seen = seen.borrow();
    assert_eq!(seen.len(), 1);
    assert!(seen[0].to_string_lossy().ends_with("tool.exe"));
    assert!(!seen[0].to_string_lossy().starts_with("\\\\?\\"));
}
