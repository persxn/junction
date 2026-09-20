//! The per-spawn client secret (ruling A2): 32 bytes of OS entropy, hex encoded,
//! handed to the backend in its environment and to the UI over IPC. It is never
//! written to disk and never reused - a restart gets a new one, which is what the
//! `generation` counter tells the UI about.

/// Bytes of entropy behind the secret; the header carries them as 64 hex chars.
pub const SECRET_BYTES: usize = 32;

/// A fresh client secret, or the reason the OS would not give us randomness.
pub fn client_secret() -> Result<String, String> {
    let mut bytes = [0u8; SECRET_BYTES];
    getrandom::fill(&mut bytes).map_err(|cause| format!("no OS randomness available: {cause}"))?;
    Ok(to_hex(&bytes))
}

fn to_hex(bytes: &[u8]) -> String {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_sixty_four_lowercase_hex_characters() {
        let secret = client_secret().expect("the OS has randomness");
        assert_eq!(secret.len(), SECRET_BYTES * 2);
        assert!(secret.chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(secret, secret.to_lowercase());
    }

    #[test]
    fn is_different_every_time_it_is_asked_for() {
        let first = client_secret().expect("randomness");
        let second = client_secret().expect("randomness");
        assert_ne!(first, second);
    }

    #[test]
    fn encodes_the_edges_of_a_byte() {
        assert_eq!(to_hex(&[0x00, 0x0f, 0xf0, 0xff]), "000ff0ff");
    }
}
