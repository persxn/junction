//! Writing a file the user asked for, and nothing else (ruling R43).
//!
//! The setup wizard has to put a recovery file on disk. §3.2 rule 2 allows IPC
//! for shell concerns - a native dialog is one - but a command that takes a path
//! from the page and writes to it is a command that writes anywhere the page
//! says, and the page is a browser.
//!
//! So the shell remembers which folders the user picked **in a native dialog
//! during this run**, and refuses to write outside them. The page can name a
//! file inside such a folder and nothing else: no separators, no `..`, no drive
//! letters. The rules below are pure functions so they can be tested without a
//! window, a dialog or a filesystem.

use std::path::{Component, Path, PathBuf};

/// Why a write was refused. Each one is a different thing to tell the user.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WriteRefusal {
    /// The folder is not one the user picked in a dialog during this run.
    FolderNotPicked,
    /// The name is not a plain file name (it has a path in it).
    UnsafeFileName,
    /// The file is already there and the caller did not ask to replace it.
    AlreadyExists,
}

impl WriteRefusal {
    /// The message the UI shows. Plain, and never a path the caller did not send.
    pub fn message(self) -> &'static str {
        match self {
            Self::FolderNotPicked => {
                "That folder was not chosen in the file dialog, so nothing was written."
            }
            Self::UnsafeFileName => "That file name is not a plain file name.",
            Self::AlreadyExists => "A file with that name is already there.",
        }
    }
}

/// A plain file name: one component, no separators, no `..`, not empty.
///
/// `Path::components` normalises away a lot, so the raw string is checked too -
/// `a/b` must not become `b` on the way through.
pub fn is_plain_file_name(name: &str) -> bool {
    if name.is_empty() || name.len() > 255 {
        return false;
    }
    if name.contains(['/', '\\', ':']) {
        return false;
    }
    if name == "." || name == ".." {
        return false;
    }
    let path = Path::new(name);
    let mut components = path.components();
    matches!(components.next(), Some(Component::Normal(_))) && components.next().is_none()
}

/// True when `folder` is one of the folders the user picked, compared after
/// normalisation so `C:\x` and `C:\x\` are the same folder.
pub fn folder_was_picked(folder: &Path, picked: &[PathBuf]) -> bool {
    let target = normalise(folder);
    picked
        .iter()
        .any(|candidate| normalise(candidate) == target)
}

/// Lower-cased, separator-normalised, trailing separator removed. Windows paths
/// are case-insensitive, so a case-sensitive comparison would refuse a folder
/// the user really did pick.
fn normalise(path: &Path) -> String {
    let text = path.to_string_lossy().replace('/', "\\").to_lowercase();
    let trimmed = text.trim_end_matches('\\');
    if trimmed.is_empty() {
        text
    } else {
        trimmed.to_owned()
    }
}

/// Decides whether a write is allowed, without performing it.
///
/// `exists` is injected so the decision can be tested without touching a disk.
pub fn authorise_write(
    folder: &Path,
    file_name: &str,
    overwrite: bool,
    picked: &[PathBuf],
    exists: &dyn Fn(&Path) -> bool,
) -> Result<PathBuf, WriteRefusal> {
    if !folder_was_picked(folder, picked) {
        return Err(WriteRefusal::FolderNotPicked);
    }
    if !is_plain_file_name(file_name) {
        return Err(WriteRefusal::UnsafeFileName);
    }
    let target = folder.join(file_name);
    if !overwrite && exists(&target) {
        return Err(WriteRefusal::AlreadyExists);
    }
    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn picked() -> Vec<PathBuf> {
        vec![PathBuf::from(r"C:\Users\Someone\Documents")]
    }

    fn never_exists(_: &Path) -> bool {
        false
    }

    fn always_exists(_: &Path) -> bool {
        true
    }

    #[test]
    fn writes_into_a_folder_the_user_picked() {
        let target = authorise_write(
            Path::new(r"C:\Users\Someone\Documents"),
            "compintel-recovery-20260920.txt",
            false,
            &picked(),
            &never_exists,
        )
        .expect("a picked folder and a plain name are allowed");
        assert_eq!(
            target,
            PathBuf::from(r"C:\Users\Someone\Documents\compintel-recovery-20260920.txt")
        );
    }

    #[test]
    fn ignores_a_trailing_separator_and_case() {
        assert!(
            authorise_write(
                Path::new(r"c:\users\someone\documents\"),
                "file.txt",
                false,
                &picked(),
                &never_exists,
            )
            .is_ok()
        );
    }

    #[test]
    fn refuses_a_folder_that_was_never_picked() {
        for folder in [
            r"C:\Windows\System32",
            r"C:\Users\Someone",
            r"C:\Users\Someone\Documents\..\Desktop",
        ] {
            assert_eq!(
                authorise_write(
                    Path::new(folder),
                    "file.txt",
                    false,
                    &picked(),
                    &never_exists
                ),
                Err(WriteRefusal::FolderNotPicked),
                "{folder} must not be writable"
            );
        }
    }

    #[test]
    fn refuses_anything_that_is_not_a_plain_file_name() {
        for name in [
            r"..\..\Windows\System32\evil.txt",
            "sub/dir/file.txt",
            r"sub\file.txt",
            "C:file.txt",
            "..",
            ".",
            "",
        ] {
            assert_eq!(
                authorise_write(
                    Path::new(r"C:\Users\Someone\Documents"),
                    name,
                    false,
                    &picked(),
                    &never_exists,
                ),
                Err(WriteRefusal::UnsafeFileName),
                "{name:?} must not be accepted"
            );
        }
    }

    #[test]
    fn refuses_an_existing_file_unless_told_to_replace_it() {
        let folder = Path::new(r"C:\Users\Someone\Documents");
        assert_eq!(
            authorise_write(folder, "file.txt", false, &picked(), &always_exists),
            Err(WriteRefusal::AlreadyExists)
        );
        assert!(authorise_write(folder, "file.txt", true, &picked(), &always_exists).is_ok());
    }

    #[test]
    fn nothing_is_writable_before_a_dialog_has_been_used() {
        assert_eq!(
            authorise_write(
                Path::new(r"C:\Users\Someone\Documents"),
                "file.txt",
                false,
                &[],
                &never_exists,
            ),
            Err(WriteRefusal::FolderNotPicked)
        );
    }

    #[test]
    fn plain_file_names_are_recognised() {
        assert!(is_plain_file_name("compintel-recovery-20260920.txt"));
        assert!(is_plain_file_name("file with spaces.txt"));
        assert!(!is_plain_file_name(&"x".repeat(256)));
    }
}
