//! The data key that seals the professor's stored sessions (ruling R76).
//!
//! A captured cookie is live access to somebody's account — it can register,
//! edit a profile, submit. R74 stored it "like an API key", and §6.2 calls API
//! keys low-value; R76 corrects that. The cookie is sealed in the database under
//! a key that lives outside it, and this file is where that key lives.
//!
//! Three properties are the point.
//!
//! 1. **It is not in the database.** A copy of `app.db`, or a backup restored on
//!    another machine, carries sealed bytes and no way to open them.
//! 2. **It is not readable as a file either.** The 32 bytes on disk are wrapped
//!    by DPAPI for the current Windows user, so another account on the same
//!    machine — and the same file on a different machine — gets a clean failure
//!    rather than a key.
//! 3. **A missing key is a state, not a crash.** The backend is told there is no
//!    key, reports sessions as unavailable on this machine, and reads the
//!    sources' public pages. That is the existing "no session" behaviour, which
//!    is exactly what a standalone or server-mode backend already does.

use std::path::{Path, PathBuf};

/// `<dataDir>\session-key.bin` (ruling R76).
pub const KEY_FILE: &str = "session-key.bin";

/// Bytes of key material; AES-256-GCM on the backend side wants 32.
pub const KEY_BYTES: usize = 32;

/// The environment variable the backend reads it from, beside the client secret.
pub const KEY_ENV: &str = "COMPINTEL_SESSION_KEY";

/// The key file's path inside a data directory.
#[must_use]
pub fn key_path(data_dir: &Path) -> PathBuf {
    data_dir.join(KEY_FILE)
}

/// Lowercase hex, the shape the backend parses.
#[must_use]
pub fn to_hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(nibble(byte >> 4));
        out.push(nibble(byte & 0x0f));
    }
    out
}

fn nibble(value: u8) -> char {
    char::from_digit(u32::from(value), 16).unwrap_or('0')
}

/// Wraps bytes so only this Windows user on this machine can unwrap them.
#[cfg(windows)]
pub fn protect(plain: &[u8]) -> Result<Vec<u8>, String> {
    use windows::Win32::Security::Cryptography::{CRYPT_INTEGER_BLOB, CryptProtectData};

    let mut input = CRYPT_INTEGER_BLOB {
        cbData: u32::try_from(plain.len()).map_err(|_| "the key is impossibly large".to_owned())?,
        pbData: plain.as_ptr().cast_mut(),
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    // SAFETY: `input` describes a buffer that outlives the call, every optional
    // argument is null, and `output` is owned by us until `take_blob` frees it.
    unsafe {
        CryptProtectData(
            std::ptr::from_mut(&mut input),
            None,
            None,
            None,
            None,
            // No UI: this runs during startup, with no window to prompt over.
            windows::Win32::Security::Cryptography::CRYPTPROTECT_UI_FORBIDDEN,
            std::ptr::from_mut(&mut output),
        )
    }
    .map_err(|cause| format!("Windows would not protect the session key: {cause}"))?;
    Ok(take_blob(&mut output))
}

/// Unwraps what {@link protect} wrapped. A blob from another user or another
/// machine fails here, with a message, rather than yielding anything.
#[cfg(windows)]
pub fn unprotect(sealed: &[u8]) -> Result<Vec<u8>, String> {
    use windows::Win32::Security::Cryptography::{CRYPT_INTEGER_BLOB, CryptUnprotectData};

    let mut input = CRYPT_INTEGER_BLOB {
        cbData: u32::try_from(sealed.len())
            .map_err(|_| "that key file is impossibly large".to_owned())?,
        pbData: sealed.as_ptr().cast_mut(),
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    // SAFETY: as above.
    unsafe {
        CryptUnprotectData(
            std::ptr::from_mut(&mut input),
            None,
            None,
            None,
            None,
            windows::Win32::Security::Cryptography::CRYPTPROTECT_UI_FORBIDDEN,
            std::ptr::from_mut(&mut output),
        )
    }
    .map_err(|cause| format!("that session key was not made by this Windows account: {cause}"))?;
    Ok(take_blob(&mut output))
}

/// Copies a blob Windows allocated and gives its memory back.
#[cfg(windows)]
fn take_blob(blob: &mut windows::Win32::Security::Cryptography::CRYPT_INTEGER_BLOB) -> Vec<u8> {
    use windows::Win32::Foundation::{HLOCAL, LocalFree};

    // SAFETY: Windows filled this blob and documents the buffer as LocalAlloc'd;
    // it is copied before being freed and the pointer is not used again.
    let bytes = unsafe { std::slice::from_raw_parts(blob.pbData, blob.cbData as usize) }.to_vec();
    unsafe { LocalFree(Some(HLOCAL(blob.pbData.cast()))) };
    blob.pbData = std::ptr::null_mut();
    blob.cbData = 0;
    bytes
}

#[cfg(not(windows))]
pub fn protect(_plain: &[u8]) -> Result<Vec<u8>, String> {
    Err("Sealing the session key is only implemented on Windows.".to_owned())
}

#[cfg(not(windows))]
pub fn unprotect(_sealed: &[u8]) -> Result<Vec<u8>, String> {
    Err("Opening the session key is only implemented on Windows.".to_owned())
}

/// Reads the data key, creating it on first run, as hex for the backend's
/// environment.
///
/// Every failure is reported rather than raised: a machine where DPAPI will not
/// play, a read-only data directory, a key file from another account. The caller
/// starts the backend without a key, and the app works with public pages only —
/// which is better than not starting at all over a feature the professor may not
/// even use.
pub fn ensure(data_dir: &Path) -> Result<String, String> {
    let path = key_path(data_dir);
    if path.exists() {
        let sealed = std::fs::read(&path)
            .map_err(|cause| format!("cannot read {}: {cause}", path.display()))?;
        let key = unprotect(&sealed)?;
        if key.len() != KEY_BYTES {
            return Err(format!(
                "{} holds {} bytes, not {KEY_BYTES}",
                path.display(),
                key.len()
            ));
        }
        return Ok(to_hex(&key));
    }

    let mut key = [0u8; KEY_BYTES];
    getrandom::fill(&mut key).map_err(|cause| format!("no OS randomness available: {cause}"))?;
    let sealed = protect(&key)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|cause| format!("cannot create {}: {cause}", parent.display()))?;
    }
    std::fs::write(&path, &sealed)
        .map_err(|cause| format!("cannot write {}: {cause}", path.display()))?;
    Ok(to_hex(&key))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Scratch under `%LOCALAPPDATA%\CompIntel-dev	est-tmp`, never the system
    /// temp folder — the same rule the rest of the repository's tests follow.
    fn scratch(name: &str) -> PathBuf {
        let base = std::env::var("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|_| std::env::temp_dir());
        let dir = base
            .join("CompIntel-dev")
            .join("test-tmp")
            .join(format!("session-key-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("scratch");
        dir
    }

    #[test]
    fn hex_is_lowercase_and_covers_the_edges_of_a_byte() {
        assert_eq!(to_hex(&[0x00, 0x0f, 0xf0, 0xff]), "000ff0ff");
    }

    #[test]
    fn the_key_lives_beside_the_database_not_inside_it() {
        let path = key_path(Path::new("C:\\data"));
        assert!(path.ends_with(KEY_FILE));
        assert_eq!(path.parent(), Some(Path::new("C:\\data")));
    }

    #[cfg(windows)]
    #[test]
    fn the_key_round_trips_through_dpapi() {
        let key = [7u8; KEY_BYTES];
        let sealed = protect(&key).expect("DPAPI is available");
        // What lands on disk is not the key.
        assert_ne!(sealed.as_slice(), key.as_slice());
        assert!(sealed.len() > KEY_BYTES);
        assert_eq!(unprotect(&sealed).expect("unprotect"), key.to_vec());
    }

    #[cfg(windows)]
    #[test]
    fn a_key_file_this_account_did_not_write_fails_cleanly() {
        // A blob from another Windows user is, to this process, a blob that does
        // not authenticate — which is the same failure and the same message.
        for foreign in [
            vec![0u8; 64],
            b"not a DPAPI blob at all".to_vec(),
            Vec::new(),
        ] {
            let opened = unprotect(&foreign);
            assert!(opened.is_err(), "{foreign:?} should not open");
            assert!(
                opened
                    .unwrap_err()
                    .contains("not made by this Windows account")
            );
        }
        // And one byte of tampering with a real blob is refused too.
        let mut sealed = protect(&[3u8; KEY_BYTES]).expect("DPAPI");
        let last = sealed.len() - 1;
        sealed[last] ^= 0xff;
        assert!(unprotect(&sealed).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn the_first_run_creates_the_key_and_every_run_after_reads_the_same_one() {
        let dir = scratch("create");
        let first = ensure(&dir).expect("created");
        assert_eq!(first.len(), KEY_BYTES * 2);
        assert!(first.chars().all(|c| c.is_ascii_hexdigit()));
        assert!(key_path(&dir).exists());

        assert_eq!(ensure(&dir).expect("read back"), first);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(windows)]
    #[test]
    fn a_key_file_that_cannot_be_opened_is_an_error_not_a_new_key() {
        let dir = scratch("foreign");
        std::fs::write(key_path(&dir), b"someone else's key").expect("write");
        let failed = ensure(&dir).expect_err("should refuse");
        assert!(failed.contains("not made by this Windows account"));
        // The bad file is left where it is: silently replacing it would throw
        // away the only thing that can open the sessions already stored.
        assert!(key_path(&dir).exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
