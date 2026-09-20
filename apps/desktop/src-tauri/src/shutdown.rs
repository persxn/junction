//! "Exit completely" asks the backend to stop itself first
//! (ARCHITECTURE.md §3.2: `POST /api/v1/system/shutdown` → wait ≤ 10 s → kill the
//! tree), so a scrape in flight and an open transaction get to finish.
//!
//! One fixed request to a known loopback port needs no HTTP client: the shell is
//! meant to stay thin, and a dependency that can negotiate TLS, proxies and
//! redirects would be a strange thing to add for `POST` to `127.0.0.1`.

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

/// Path the shutdown route is mounted at (§4.4 API prefix).
pub const SHUTDOWN_PATH: &str = "/api/v1/system/shutdown";

/// Header carrying the per-spawn client secret (ADR-0017).
pub const CLIENT_SECRET_HEADER: &str = "X-CompIntel-Client";

/// The exact bytes sent. `Connection: close` keeps this a one-shot exchange, and
/// the Host header has to match the port the backend bound, because the backend
/// rejects anything else as a DNS-rebinding attempt (ruling A3).
pub fn build_request(port: u16, secret: &str) -> String {
    format!(
        "POST {SHUTDOWN_PATH} HTTP/1.1\r\n\
         Host: 127.0.0.1:{port}\r\n\
         {CLIENT_SECRET_HEADER}: {secret}\r\n\
         Content-Length: 0\r\n\
         Connection: close\r\n\
         \r\n"
    )
}

/// Reads the status code out of an HTTP status line.
pub fn parse_status_line(line: &str) -> Result<u16, String> {
    let mut parts = line.trim_end().split(' ');
    let version = parts.next().unwrap_or_default();
    if !version.starts_with("HTTP/1.") {
        return Err(format!("not an HTTP response: {line:?}"));
    }
    let code = parts
        .next()
        .ok_or_else(|| format!("no status code in {line:?}"))?;
    code.parse::<u16>()
        .map_err(|_| format!("unreadable status code in {line:?}"))
}

/// Asks the backend to shut down and returns the HTTP status it answered with.
/// A refusal (401, 404) or a network error is not fatal: the caller falls back to
/// killing the process tree, which is why the error is a message, not a panic.
pub fn request_shutdown(port: u16, secret: &str, timeout: Duration) -> Result<u16, String> {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream = TcpStream::connect_timeout(&address, timeout)
        .map_err(|cause| format!("cannot reach the backend on {address}: {cause}"))?;
    stream
        .set_write_timeout(Some(timeout))
        .and_then(|()| stream.set_read_timeout(Some(timeout)))
        .map_err(|cause| format!("cannot set a timeout on the shutdown request: {cause}"))?;

    stream
        .write_all(build_request(port, secret).as_bytes())
        .map_err(|cause| format!("cannot send the shutdown request: {cause}"))?;
    stream
        .flush()
        .map_err(|cause| format!("cannot flush the shutdown request: {cause}"))?;

    // The body is irrelevant - 202 means "it is stopping" - so only enough bytes
    // to hold a status line are read.
    let mut head = [0u8; 64];
    let read = stream
        .read(&mut head)
        .map_err(|cause| format!("no answer to the shutdown request: {cause}"))?;
    let text = String::from_utf8_lossy(&head[..read]);
    let first = text.lines().next().unwrap_or_default();
    parse_status_line(first)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::BufRead;
    use std::net::TcpListener;
    use std::thread;

    #[test]
    fn the_request_carries_the_secret_and_a_matching_host() {
        let request = build_request(52991, "abc123");
        assert!(request.starts_with("POST /api/v1/system/shutdown HTTP/1.1\r\n"));
        assert!(request.contains("Host: 127.0.0.1:52991\r\n"));
        assert!(request.contains("X-CompIntel-Client: abc123\r\n"));
        assert!(request.contains("Content-Length: 0\r\n"));
        assert!(request.ends_with("\r\n\r\n"));
    }

    #[test]
    fn reads_the_status_code() {
        assert_eq!(parse_status_line("HTTP/1.1 202 Accepted"), Ok(202));
        assert_eq!(parse_status_line("HTTP/1.0 401 Unauthorized\r\n"), Ok(401));
        assert!(parse_status_line("").is_err());
        assert!(parse_status_line("hello").is_err());
        assert!(parse_status_line("HTTP/1.1 nope").is_err());
    }

    #[test]
    fn talks_to_a_real_socket_and_reports_what_it_answered() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind");
        let port = listener.local_addr().expect("addr").port();

        let server = thread::spawn(move || {
            let (stream, _) = listener.accept().expect("accept");
            let mut reader = std::io::BufReader::new(&stream);
            let mut request = String::new();
            loop {
                let mut line = String::new();
                if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
                    break;
                }
                request.push_str(&line);
            }
            let mut writer = &stream;
            writer
                .write_all(b"HTTP/1.1 202 Accepted\r\nContent-Length: 0\r\n\r\n")
                .expect("write");
            request
        });

        let status = request_shutdown(port, "deadbeef", Duration::from_secs(5)).expect("answered");
        assert_eq!(status, 202);

        let request = server.join().expect("server thread");
        assert!(request.contains("X-CompIntel-Client: deadbeef"));
        assert!(request.contains(&format!("Host: 127.0.0.1:{port}")));
    }

    #[test]
    fn a_closed_port_is_an_error_not_a_panic() {
        // Bind and drop, so the port is almost certainly free again.
        let port = {
            let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind");
            listener.local_addr().expect("addr").port()
        };
        assert!(request_shutdown(port, "x", Duration::from_millis(250)).is_err());
    }
}
