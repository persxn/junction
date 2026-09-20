//! A very small HTTP client for one server: the backend, on `127.0.0.1:<port>`.
//!
//! Two callers need it. "Exit completely" asks the backend to stop itself first
//! (ARCHITECTURE.md §3.2: `POST /api/v1/system/shutdown` → wait ≤ 10 s → kill the
//! tree). And when WebView2 refuses to reach the loopback API at all - the Local
//! Network Access risk in finding F9 - the UI can route its GETs through the
//! shell instead, which is the fallback that finding asks for.
//!
//! A dependency that can negotiate TLS, proxies and redirects would be a strange
//! thing to add for a fixed request to a known local port, so this is hand-written
//! and tested against a real socket.

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

use serde::Serialize;

/// Path the shutdown route is mounted at (§4.4 API prefix).
pub const SHUTDOWN_PATH: &str = "/api/v1/system/shutdown";

/// Everything the UI may ask the shell to fetch lives under this prefix.
pub const API_PREFIX: &str = "/api/v1/";

/// Header carrying the per-spawn client secret (ADR-0017).
pub const CLIENT_SECRET_HEADER: &str = "X-CompIntel-Client";

/// Bodies larger than this are truncated; the shell only proxies small JSON.
pub const MAX_RESPONSE_BYTES: usize = 256 * 1024;

/// What a proxied request answered, as the UI sees it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoopbackResponse {
    pub status: u16,
    pub body: String,
}

/// The exact bytes sent. `Connection: close` keeps this a one-shot exchange, and
/// the Host header has to match the port the backend bound, because the backend
/// rejects anything else as a DNS-rebinding attempt (ruling A3).
pub fn build_request(method: &str, path: &str, port: u16, secret: &str) -> String {
    format!(
        "{method} {path} HTTP/1.1\r\n\
         Host: 127.0.0.1:{port}\r\n\
         {CLIENT_SECRET_HEADER}: {secret}\r\n\
         Accept: application/json\r\n\
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

/// Splits a raw HTTP/1.1 response into its status code and its body.
pub fn parse_response(raw: &str) -> Result<LoopbackResponse, String> {
    let (head, body) = raw
        .split_once("\r\n\r\n")
        .map_or((raw, ""), |(head, body)| (head, body));
    let status = parse_status_line(head.lines().next().unwrap_or_default())?;
    Ok(LoopbackResponse {
        status,
        body: body.to_owned(),
    })
}

/// Sends one request and reads the whole (small) response.
pub fn request(
    method: &str,
    path: &str,
    port: u16,
    secret: &str,
    timeout: Duration,
) -> Result<LoopbackResponse, String> {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream = TcpStream::connect_timeout(&address, timeout)
        .map_err(|cause| format!("cannot reach the backend on {address}: {cause}"))?;
    stream
        .set_write_timeout(Some(timeout))
        .and_then(|()| stream.set_read_timeout(Some(timeout)))
        .map_err(|cause| format!("cannot set a timeout on the request: {cause}"))?;

    stream
        .write_all(build_request(method, path, port, secret).as_bytes())
        .and_then(|()| stream.flush())
        .map_err(|cause| format!("cannot send {method} {path}: {cause}"))?;

    // `Connection: close` means end-of-stream marks the end of the body, so there
    // is no need to understand Content-Length or chunked encoding here.
    let mut raw = Vec::new();
    let mut chunk = [0u8; 8192];
    loop {
        let read = stream
            .read(&mut chunk)
            .map_err(|cause| format!("no answer to {method} {path}: {cause}"))?;
        if read == 0 {
            break;
        }
        raw.extend_from_slice(&chunk[..read]);
        if raw.len() >= MAX_RESPONSE_BYTES {
            break;
        }
    }
    parse_response(&String::from_utf8_lossy(&raw))
}

/// Asks the backend to shut down and returns the HTTP status it answered with.
/// A refusal (401, 404) or a network error is not fatal: the caller falls back to
/// killing the process tree, which is why the error is a message, not a panic.
pub fn request_shutdown(port: u16, secret: &str, timeout: Duration) -> Result<u16, String> {
    request("POST", SHUTDOWN_PATH, port, secret, timeout).map(|response| response.status)
}

/// True for the paths the UI is allowed to ask the shell to fetch. The WebView is
/// the least trusted part of the app, so the fallback transport is a read-only
/// window onto the API, not a general-purpose local HTTP client.
pub fn is_proxyable(method: &str, path: &str) -> bool {
    method.eq_ignore_ascii_case("GET")
        && path.starts_with(API_PREFIX)
        && !path.contains("..")
        && !path.contains('\\')
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::BufRead;
    use std::net::TcpListener;
    use std::thread;

    /// Answers one request with a canned response and hands back what it received.
    fn echo_server(response: &'static str) -> (u16, thread::JoinHandle<String>) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind");
        let port = listener.local_addr().expect("addr").port();
        let handle = thread::spawn(move || {
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
            writer.write_all(response.as_bytes()).expect("write");
            request
        });
        (port, handle)
    }

    #[test]
    fn the_request_carries_the_secret_and_a_matching_host() {
        let request = build_request("POST", SHUTDOWN_PATH, 52991, "abc123");
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
    fn splits_the_body_from_the_headers() {
        let raw = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"status\":\"ok\"}";
        assert_eq!(
            parse_response(raw),
            Ok(LoopbackResponse {
                status: 200,
                body: "{\"status\":\"ok\"}".to_owned(),
            })
        );
    }

    #[test]
    fn shutdown_talks_to_a_real_socket_and_reports_what_it_answered() {
        let (port, server) = echo_server("HTTP/1.1 202 Accepted\r\nContent-Length: 0\r\n\r\n");

        let status = request_shutdown(port, "deadbeef", Duration::from_secs(5)).expect("answered");
        assert_eq!(status, 202);

        let request = server.join().expect("server thread");
        assert!(request.contains("X-CompIntel-Client: deadbeef"));
        assert!(request.contains(&format!("Host: 127.0.0.1:{port}")));
    }

    #[test]
    fn a_proxied_get_returns_the_status_and_the_body() {
        let (port, server) = echo_server(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"status\":\"ok\"}",
        );

        let response = request(
            "GET",
            "/api/v1/health",
            port,
            "secret",
            Duration::from_secs(5),
        )
        .expect("answered");
        assert_eq!(response.status, 200);
        assert_eq!(response.body, "{\"status\":\"ok\"}");

        let request = server.join().expect("server thread");
        assert!(request.starts_with("GET /api/v1/health HTTP/1.1\r\n"));
        assert!(request.contains("Accept: application/json"));
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

    #[test]
    fn only_reads_under_the_api_prefix_may_be_proxied() {
        assert!(is_proxyable("GET", "/api/v1/health"));
        assert!(is_proxyable("get", "/api/v1/events?limit=20"));
        // Writes, other paths and traversal attempts stay out of the WebView's reach.
        assert!(!is_proxyable("POST", "/api/v1/system/shutdown"));
        assert!(!is_proxyable("DELETE", "/api/v1/events/1"));
        assert!(!is_proxyable("GET", "/internal/metrics"));
        assert!(!is_proxyable("GET", "/api/v1/../../secrets"));
        assert!(!is_proxyable("GET", "/api/v1/a\\b"));
    }
}
