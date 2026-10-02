//! Reading the one file the user just picked, and nothing else (WP-17, R43's
//! pattern for reads).
//!
//! The student import needs a CSV or XLSX file's bytes. A command that reads a
//! path the page names reads anything the page names, so the shell remembers
//! the **last file picked in a native dialog during this run** and reads that
//! file only: the extension must be `.csv` or `.xlsx` and the size at most R93's
//! 700 KB. The rules are pure functions, tested without a dialog or a disk.

use std::path::Path;

/// R93's limit on an import file, in bytes.
pub const MAX_IMPORT_BYTES: u64 = 700 * 1024;

/// Extensions the import reads.
pub const IMPORT_EXTENSIONS: [&str; 2] = ["csv", "xlsx"];

/// Why a read was refused. Each one is a different thing to tell the user.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReadRefusal {
    /// Not the file the user picked in the dialog (or nothing was picked).
    NotPicked,
    /// Not a `.csv` or `.xlsx` file.
    WrongExtension,
    /// Larger than `MAX_IMPORT_BYTES`.
    TooLarge,
}

impl ReadRefusal {
    /// The message the UI shows; it names the limit, never a path.
    pub fn message(self) -> &'static str {
        match self {
            Self::NotPicked => "That file was not chosen in the file dialog, so it was not read.",
            Self::WrongExtension => "Only .csv and .xlsx files can be imported.",
            Self::TooLarge => {
                "That file is larger than 700 KB, so it was not read. Split it into smaller files."
            }
        }
    }
}

/// Lower-cased, separator-normalised: Windows paths are case-insensitive.
fn normalise(path: &Path) -> String {
    path.to_string_lossy().replace('/', "\\").to_lowercase()
}

/// Whether the extension is one the import reads, case-insensitively.
pub fn has_import_extension(path: &Path) -> bool {
    path.extension()
        .map(|ext| ext.to_string_lossy().to_lowercase())
        .is_some_and(|ext| IMPORT_EXTENSIONS.contains(&ext.as_str()))
}

/// Decides whether a read is allowed, without performing it.
pub fn authorise_read(path: &Path, picked: Option<&Path>, size: u64) -> Result<(), ReadRefusal> {
    match picked {
        Some(chosen) if normalise(chosen) == normalise(path) => {}
        _ => return Err(ReadRefusal::NotPicked),
    }
    if !has_import_extension(path) {
        return Err(ReadRefusal::WrongExtension);
    }
    if size > MAX_IMPORT_BYTES {
        return Err(ReadRefusal::TooLarge);
    }
    Ok(())
}

/// The picked path's file name, for the UI to show.
pub fn display_name(path: &Path) -> String {
    path.file_name().map_or_else(
        || path.to_string_lossy().into_owned(),
        |name| name.to_string_lossy().into_owned(),
    )
}

const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// Standard base64 with padding (RFC 4648 §4) — enough to hand bytes to the page
/// without a crate for it.
pub fn base64_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b0 = u32::from(chunk[0]);
        let b1 = u32::from(chunk.get(1).copied().unwrap_or(0));
        let b2 = u32::from(chunk.get(2).copied().unwrap_or(0));
        let triple = (b0 << 16) | (b1 << 8) | b2;
        let index = |shift: u32| ALPHABET[((triple >> shift) & 0x3f) as usize] as char;
        out.push(index(18));
        out.push(index(12));
        out.push(if chunk.len() > 1 { index(6) } else { '=' });
        out.push(if chunk.len() > 2 { index(0) } else { '=' });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn picked() -> PathBuf {
        PathBuf::from(r"C:\Users\Someone\Documents\students.csv")
    }

    #[test]
    fn reads_the_file_the_user_picked() {
        assert_eq!(authorise_read(&picked(), Some(&picked()), 10_000), Ok(()));
        assert_eq!(
            authorise_read(
                Path::new(r"c:\users\someone\documents\STUDENTS.CSV"),
                Some(&picked()),
                1
            ),
            Ok(())
        );
    }

    #[test]
    fn refuses_a_path_that_was_not_picked() {
        let other = Path::new(r"C:\Windows\System32\drivers\etc\hosts.csv");
        assert_eq!(
            authorise_read(other, Some(&picked()), 1),
            Err(ReadRefusal::NotPicked)
        );
        assert_eq!(
            authorise_read(&picked(), None, 1),
            Err(ReadRefusal::NotPicked)
        );
    }

    #[test]
    fn refuses_an_executable_even_if_it_was_picked() {
        let exe = PathBuf::from(r"C:\Users\Someone\Downloads\setup.exe");
        assert_eq!(
            authorise_read(&exe, Some(&exe), 1),
            Err(ReadRefusal::WrongExtension)
        );
        let xls = PathBuf::from(r"C:\Users\Someone\old.xls");
        assert_eq!(
            authorise_read(&xls, Some(&xls), 1),
            Err(ReadRefusal::WrongExtension)
        );
    }

    #[test]
    fn refuses_701_kb_and_names_the_limit() {
        assert_eq!(
            authorise_read(&picked(), Some(&picked()), 701 * 1024),
            Err(ReadRefusal::TooLarge)
        );
        assert!(authorise_read(&picked(), Some(&picked()), MAX_IMPORT_BYTES).is_ok());
        assert!(ReadRefusal::TooLarge.message().contains("700 KB"));
    }

    #[test]
    fn accepts_xlsx_in_any_case() {
        let book = PathBuf::from(r"C:\x\Roster.XLSX");
        assert!(authorise_read(&book, Some(&book), 1).is_ok());
    }

    #[test]
    fn encodes_base64_like_rfc_4648() {
        for (input, expected) in [
            ("", ""),
            ("f", "Zg=="),
            ("fo", "Zm8="),
            ("foo", "Zm9v"),
            ("foob", "Zm9vYg=="),
            ("fooba", "Zm9vYmE="),
            ("foobar", "Zm9vYmFy"),
        ] {
            assert_eq!(base64_encode(input.as_bytes()), expected, "{input:?}");
        }
        assert_eq!(base64_encode(&[0xff, 0xfe, 0x00]), "//4A");
    }

    #[test]
    fn shows_only_the_file_name() {
        assert_eq!(display_name(&picked()), "students.csv");
    }
}
