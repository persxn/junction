//! A very small HTTP client for one server: the backend, on `127.0.0.1:<port>`.
//!
//! Two callers need it. "Exit completely" asks the backend to stop itself first
//! (ARCHITECTURE.md §3.2: `POST /api/v1/system/shutdown` → wait ≤ 10 s → kill the
//! tree). And when WebView2 refuses to reach the loopback API at all - the Local
//! Network Access risk in finding F9 - the UI routes its requests through the
//! shell instead, which is the fallback that finding asks for.
//!
//! Ruling R78 widened that fallback from reads to writes. It has to be wide
//! enough to carry Save, Hide, a category override, POST search and every M2
//! form, and no wider: the WebView is the least trusted part of the app, so the
//! proxy is a window onto `/api/v1` with the system routes and the stream cut
//! out of it, not a general-purpose local HTTP client.
//!
//! A dependency that can negotiate TLS, proxies and redirects would be a strange
//! thing to add for a fixed request to a known local port, so this is hand-written
//! and tested against a real socket. It follows no redirects for the same reason
//! it speaks no TLS: there is exactly one server it may talk to, and a `Location`
//! header is that server asking to be pointed somewhere else.

use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

use serde::{Deserialize, Serialize};

/// Path the shutdown route is mounted at (§4.4 API prefix).
pub const SHUTDOWN_PATH: &str = "/api/v1/system/shutdown";

/// Everything the UI may ask the shell to reach lives under this prefix.
pub const API_PREFIX: &str = "/api/v1/";

/// The app's own lifecycle routes; the page reaches those over IPC, not here.
pub const SYSTEM_PREFIX: &str = "/api/v1/system/";

/// SSE is a stream, and the proxy is request/response (ruling R30).
pub const STREAM_PATH: &str = "/api/v1/stream";

/// Header carrying the per-spawn client secret (ADR-0017).
pub const CLIENT_SECRET_HEADER: &str = "X-CompIntel-Client";

/// Header carrying the session bearer token (ADR-0017, ruling R27).
pub const AUTHORIZATION_HEADER: &str = "Authorization";

/// The only request body the proxy carries (ruling R78).
pub const JSON_CONTENT_TYPE: &str = "application/json";

/// The backend's own body limit, mirrored here so an oversized write is refused
/// before it is sent rather than after (ruling R78).
pub const MAX_BODY_BYTES: usize = 1024 * 1024;

/// Bodies larger than this are truncated; the shell only proxies small JSON.
pub const MAX_RESPONSE_BYTES: usize = 256 * 1024;

/// The methods the app's own screens use (ruling R78).
pub const PROXYABLE_METHODS: [&str; 5] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

/// Request headers the page may ask the shell to forward, lower-cased.
///
/// Everything else is refused rather than quietly dropped: a header that is
/// ignored without a word makes the shell send a request nobody asked for.
pub const FORWARDABLE_HEADERS: [&str; 3] = ["authorization", "content-type", "accept"];

/// What the UI asks the shell to send (ruling R78).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyRequest {
    pub method: String,
    pub path: String,
    /// Header names are matched case-insensitively against `FORWARDABLE_HEADERS`.
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
    /// A JSON document, or `None` for a request without a body.
    #[serde(default)]
    pub body: Option<String>,
}

/// What a proxied request answered, as the UI sees it: status, headers and body
/// exactly as the backend wrote them, so the API client can read a problem
/// document out of the fallback the same way it reads one out of `fetch`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoopbackResponse {
    pub status: u16,
    /// `[name, value]` pairs in the order the server sent them; a header may
    /// legitimately appear twice, so this is not a map.
    pub headers: Vec<(String, String)>,
    pub body: String,
}

impl LoopbackResponse {
    /// The first value for a header name, matched case-insensitively.
    #[must_use]
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }
}

/// Everything the shell will send, once it has agreed to send it.
#[derive(Debug, Clone)]
pub struct OutgoingRequest<'a> {
    pub method: &'a str,
    pub path: &'a str,
    pub port: u16,
    pub secret: &'a str,
    pub authorization: Option<&'a str>,
    pub body: Option<&'a str>,
}

/// The exact bytes sent. `Connection: close` keeps this a one-shot exchange, and
/// the Host header has to match the port the backend bound, because the backend
/// rejects anything else as a DNS-rebinding attempt (ruling A3).
///
/// `authorization` is the session bearer token (ruling R27). Without it the
/// fallback transport could only ever reach `/health`, so on a machine where
/// WebView2 blocks loopback the app would be unusable after signing in. The
/// value is dropped unless it is safe to put in a header, so nothing can smuggle
/// a second header — or a second request — through this string.
#[must_use]
pub fn build_request(request: &OutgoingRequest<'_>) -> String {
    let OutgoingRequest {
        method,
        path,
        port,
        secret,
        authorization,
        body,
    } = *request;
    let auth_line = match authorization {
        Some(value) if is_header_safe(value) => format!("{AUTHORIZATION_HEADER}: {value}\r\n"),
        _ => String::new(),
    };
    let content_type_line = match body {
        Some(_) => format!("Content-Type: {JSON_CONTENT_TYPE}\r\n"),
        None => String::new(),
    };
    let payload = body.unwrap_or_default();
    format!(
        "{method} {path} HTTP/1.1\r\n\
         Host: 127.0.0.1:{port}\r\n\
         {CLIENT_SECRET_HEADER}: {secret}\r\n\
         {auth_line}\
         {content_type_line}\
         Accept: application/json\r\n\
         Content-Length: {}\r\n\
         Connection: close\r\n\
         \r\n{payload}",
        payload.len()
    )
}

/// A header value must not be able to end the header or start another one.
#[must_use]
pub fn is_header_safe(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 8192
        && value.is_ascii()
        && !value.contains(['\r', '\n', '\0'])
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

/// Splits a raw HTTP/1.1 response into its status code, its headers and its body.
pub fn parse_response(raw: &str) -> Result<LoopbackResponse, String> {
    let (head, body) = raw
        .split_once("\r\n\r\n")
        .map_or((raw, ""), |(head, body)| (head, body));
    let mut lines = head.lines();
    let status = parse_status_line(lines.next().unwrap_or_default())?;
    let headers = lines
        .filter_map(|line| line.split_once(':'))
        .map(|(name, value)| (name.trim().to_owned(), value.trim().to_owned()))
        .collect();
    Ok(LoopbackResponse {
        status,
        headers,
        body: body.to_owned(),
    })
}

/// Sends one request and reads the whole (small) response.
///
/// A 3xx comes back as a 3xx: this client has exactly one server to talk to, so
/// a redirect is an answer to hand the caller, never an instruction to follow.
pub fn request(
    outgoing: &OutgoingRequest<'_>,
    timeout: Duration,
) -> Result<LoopbackResponse, String> {
    let (method, path, port) = (outgoing.method, outgoing.path, outgoing.port);
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream = TcpStream::connect_timeout(&address, timeout)
        .map_err(|cause| format!("cannot reach the backend on {address}: {cause}"))?;
    stream
        .set_write_timeout(Some(timeout))
        .and_then(|()| stream.set_read_timeout(Some(timeout)))
        .map_err(|cause| format!("cannot set a timeout on the request: {cause}"))?;

    stream
        .write_all(build_request(outgoing).as_bytes())
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
    request(
        &OutgoingRequest {
            method: "POST",
            path: SHUTDOWN_PATH,
            port,
            secret,
            authorization: None,
            body: None,
        },
        timeout,
    )
    .map(|response| response.status)
}

/// Why the shell would not send a request the page asked it to send.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProxyRefusal {
    Method(String),
    Path(String),
    Header(String),
    ContentType(String),
    BodyTooLarge(usize),
    BodyOnGet,
}

impl ProxyRefusal {
    /// The sentence the page is given. It names what was refused, because the
    /// page is ours and a vague refusal here is a debugging session later.
    #[must_use]
    pub fn message(&self) -> String {
        match self {
            Self::Method(method) => format!("{method} is not a method the shell will forward."),
            Self::Path(path) => format!("{path} is not a proxyable API path."),
            Self::Header(name) => format!("{name} is not a header the shell will forward."),
            Self::ContentType(value) => {
                format!("The shell forwards {JSON_CONTENT_TYPE} bodies only, not {value}.")
            }
            Self::BodyTooLarge(size) => {
                format!("That body is {size} bytes; the limit is {MAX_BODY_BYTES}.")
            }
            Self::BodyOnGet => "A GET through the shell cannot carry a body.".to_owned(),
        }
    }
}

/// True for the paths the UI is allowed to ask the shell to reach (R78).
///
/// `/api/v1/system/*` is out because those routes stop the app and the page has
/// its own IPC command for that; `/api/v1/stream` is out because it is a stream
/// and this is request/response (R30).
#[must_use]
pub fn is_proxyable_path(path: &str) -> bool {
    let route = path.split(['?', '#']).next().unwrap_or(path);
    path.starts_with(API_PREFIX)
        && !path.contains("..")
        && !path.contains('\\')
        && !route.starts_with(SYSTEM_PREFIX)
        && route != STREAM_PATH
}

/// Whether the shell will send this, and the method and token it will send with.
///
/// Every rule R78 states is checked here rather than at the call site, so the
/// command stays a thin wrapper and the rules are testable without a WebView.
pub fn authorise(request: &ProxyRequest) -> Result<(String, Option<&str>), ProxyRefusal> {
    let method = request.method.to_ascii_uppercase();
    if !PROXYABLE_METHODS.contains(&method.as_str()) {
        return Err(ProxyRefusal::Method(request.method.clone()));
    }
    if !is_proxyable_path(&request.path) {
        return Err(ProxyRefusal::Path(request.path.clone()));
    }

    let mut authorization: Option<&str> = None;
    let mut content_type: Option<&str> = None;
    for (name, value) in &request.headers {
        let lowered = name.to_ascii_lowercase();
        if !FORWARDABLE_HEADERS.contains(&lowered.as_str()) {
            return Err(ProxyRefusal::Header(name.clone()));
        }
        if lowered == "authorization" {
            authorization = Some(value.as_str());
        } else if lowered == "content-type" {
            content_type = Some(value.as_str());
        }
    }

    match request.body.as_deref() {
        Some(body) => {
            if method == "GET" {
                return Err(ProxyRefusal::BodyOnGet);
            }
            // The backend measures bytes, and a JSON body may hold non-ASCII.
            if body.len() > MAX_BODY_BYTES {
                return Err(ProxyRefusal::BodyTooLarge(body.len()));
            }
            // An absent Content-Type is fine — the shell sets the only one it
            // will send. A stated one that is not JSON describes a different
            // request from the one the shell knows how to make.
            if let Some(value) = content_type
                && !value
                    .split(';')
                    .next()
                    .unwrap_or_default()
                    .trim()
                    .eq_ignore_ascii_case(JSON_CONTENT_TYPE)
            {
                return Err(ProxyRefusal::ContentType(value.to_owned()));
            }
        }
        None => {
            if let Some(value) = content_type {
                return Err(ProxyRefusal::ContentType(value.to_owned()));
            }
        }
    }

    Ok((method, authorization))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::BufRead;
    use std::net::TcpListener;
    use std::thread;

    fn get(path: &str, port: u16) -> OutgoingRequest<'_> {
        OutgoingRequest {
            method: "GET",
            path,
            port,
            secret: "secret",
            authorization: None,
            body: None,
        }
    }

    fn proxy(method: &str, path: &str) -> ProxyRequest {
        ProxyRequest {
            method: method.to_owned(),
            path: path.to_owned(),
            headers: BTreeMap::new(),
            body: None,
        }
    }

    /// Answers one request with a canned response and hands back what it received.
    fn echo_server(response: &'static str) -> (u16, thread::JoinHandle<String>) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind");
        let port = listener.local_addr().expect("addr").port();
        let handle = thread::spawn(move || {
            let (stream, _) = listener.accept().expect("accept");
            let mut reader = std::io::BufReader::new(&stream);
            let mut request = String::new();
            let mut length = 0usize;
            loop {
                let mut line = String::new();
                if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
                    break;
                }
                if let Some(value) = line.strip_prefix("Content-Length: ") {
                    length = value.trim().parse().unwrap_or(0);
                }
                request.push_str(&line);
            }
            if length > 0 {
                let mut body = vec![0u8; length];
                reader.read_exact(&mut body).expect("body");
                request.push_str("\r\n");
                request.push_str(&String::from_utf8_lossy(&body));
            }
            let mut writer = &stream;
            writer.write_all(response.as_bytes()).expect("write");
            request
        });
        (port, handle)
    }

    #[test]
    fn the_request_carries_the_secret_and_a_matching_host() {
        let request = build_request(&OutgoingRequest {
            method: "POST",
            path: SHUTDOWN_PATH,
            port: 52991,
            secret: "abc123",
            authorization: None,
            body: None,
        });
        assert!(request.starts_with("POST /api/v1/system/shutdown HTTP/1.1\r\n"));
        assert!(request.contains("Host: 127.0.0.1:52991\r\n"));
        assert!(request.contains("X-CompIntel-Client: abc123\r\n"));
        assert!(request.contains("Content-Length: 0\r\n"));
        assert!(request.ends_with("\r\n\r\n"));
        // No session, no Authorization header at all; no body, no Content-Type.
        assert!(!request.contains("Authorization"));
        assert!(!request.contains("Content-Type"));
    }

    #[test]
    fn a_body_brings_its_length_and_its_content_type() {
        let request = build_request(&OutgoingRequest {
            method: "PUT",
            path: "/api/v1/events/1/category",
            port: 1,
            secret: "s",
            authorization: None,
            body: Some("{\"categoryId\":\"c\"}"),
        });
        assert!(request.contains("Content-Type: application/json\r\n"));
        assert!(request.contains("Content-Length: 18\r\n"));
        assert!(request.ends_with("\r\n\r\n{\"categoryId\":\"c\"}"));
    }

    #[test]
    fn the_request_forwards_a_session_token_when_there_is_one() {
        let request = build_request(&OutgoingRequest {
            authorization: Some("Bearer 0123456789abcdef"),
            ..get("/api/v1/me", 52991)
        });
        assert!(request.contains("Authorization: Bearer 0123456789abcdef\r\n"));
        // Still exactly one request, correctly terminated.
        assert_eq!(request.matches("HTTP/1.1\r\n").count(), 1);
        assert!(request.ends_with("\r\n\r\n"));
    }

    #[test]
    fn a_header_value_cannot_smuggle_another_header_or_request() {
        for hostile in [
            "Bearer x\r\nX-Admin: true",
            "Bearer x\nX-Admin: true",
            "Bearer x\r\n\r\nGET /api/v1/secrets HTTP/1.1",
            "Bearer \0",
            "",
        ] {
            assert!(!is_header_safe(hostile), "{hostile:?} should be refused");
            let request = build_request(&OutgoingRequest {
                authorization: Some(hostile),
                ..get("/api/v1/me", 1)
            });
            assert!(!request.contains("X-Admin"));
            assert_eq!(request.matches("HTTP/1.1\r\n").count(), 1);
        }
        assert!(is_header_safe("Bearer abc123"));
        // A long but plausible token is fine; an absurd one is not.
        assert!(is_header_safe(&format!("Bearer {}", "a".repeat(1024))));
        assert!(!is_header_safe(&"a".repeat(9000)));
        // Non-ASCII has no business in a bearer token.
        assert!(!is_header_safe("Bearer café"));
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
    fn splits_the_headers_and_the_body_from_the_status_line() {
        let raw = concat!(
            "HTTP/1.1 200 OK\r\n",
            "Content-Type: application/json\r\n",
            "X-Request-Id: r1\r\n\r\n",
            "{\"status\":\"ok\"}"
        );
        let response = parse_response(raw).expect("parsed");
        assert_eq!(response.status, 200);
        assert_eq!(response.body, "{\"status\":\"ok\"}");
        assert_eq!(response.header("content-type"), Some("application/json"));
        assert_eq!(response.header("X-Request-Id"), Some("r1"));
        assert_eq!(response.header("X-Missing"), None);
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
    fn a_proxied_get_returns_the_status_the_headers_and_the_body() {
        let (port, server) = echo_server(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"status\":\"ok\"}",
        );

        let response =
            request(&get("/api/v1/health", port), Duration::from_secs(5)).expect("answered");
        assert_eq!(response.status, 200);
        assert_eq!(response.body, "{\"status\":\"ok\"}");
        assert_eq!(response.header("content-type"), Some("application/json"));

        let request = server.join().expect("server thread");
        assert!(request.starts_with("GET /api/v1/health HTTP/1.1\r\n"));
        assert!(request.contains("Accept: application/json"));
    }

    #[test]
    fn every_method_the_app_uses_reaches_the_backend_with_its_body() {
        for method in PROXYABLE_METHODS {
            let (port, server) =
                echo_server("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{}");
            let body = (method != "GET").then_some("{\"hidden\":true}");
            let response = request(
                &OutgoingRequest {
                    method,
                    path: "/api/v1/events/e1/state",
                    port,
                    secret: "secret",
                    authorization: Some("Bearer t"),
                    body,
                },
                Duration::from_secs(5),
            )
            .expect("answered");
            assert_eq!(response.status, 200);

            let sent = server.join().expect("server thread");
            assert!(sent.starts_with(&format!("{method} /api/v1/events/e1/state HTTP/1.1\r\n")));
            assert!(sent.contains("Authorization: Bearer t"));
            if body.is_some() {
                assert!(
                    sent.ends_with("{\"hidden\":true}"),
                    "{method} lost its body"
                );
            }
        }
    }

    #[test]
    fn a_redirect_is_returned_rather_than_followed() {
        let (port, server) = echo_server(
            "HTTP/1.1 302 Found\r\nLocation: http://evil.test/steal\r\nContent-Length: 0\r\n\r\n",
        );
        let response =
            request(&get("/api/v1/events", port), Duration::from_secs(5)).expect("answered");
        assert_eq!(response.status, 302);
        assert_eq!(response.header("Location"), Some("http://evil.test/steal"));
        // One request was made, to us; nothing followed the Location header.
        let sent = server.join().expect("server thread");
        assert_eq!(sent.matches("HTTP/1.1\r\n").count(), 1);
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
    fn the_five_methods_the_app_uses_are_authorised_and_nothing_else_is() {
        for method in PROXYABLE_METHODS {
            assert!(
                authorise(&proxy(method, "/api/v1/search")).is_ok(),
                "{method} should be forwarded"
            );
        }
        assert!(authorise(&proxy("get", "/api/v1/events?limit=20")).is_ok());
        for method in ["HEAD", "OPTIONS", "TRACE", "CONNECT", "BREW"] {
            assert_eq!(
                authorise(&proxy(method, "/api/v1/search")),
                Err(ProxyRefusal::Method(method.to_owned()))
            );
        }
    }

    #[test]
    fn the_system_routes_the_stream_and_anything_outside_the_prefix_are_refused() {
        for path in [
            "/api/v1/system/shutdown",
            "/api/v1/system/logs",
            "/api/v1/stream",
            "/api/v1/stream?lastEventId=4",
            "/internal/metrics",
            "/api/v1/../../secrets",
            "/api/v1/a\\b",
            "/health",
        ] {
            assert_eq!(
                authorise(&proxy("GET", path)),
                Err(ProxyRefusal::Path(path.to_owned())),
                "{path} should be refused"
            );
        }
        // A route that merely starts with the same letters is not a system route.
        assert!(authorise(&proxy("GET", "/api/v1/systems")).is_ok());
    }

    #[test]
    fn a_body_must_be_json_and_must_fit_the_backends_own_limit() {
        let mut request = proxy("POST", "/api/v1/search");
        request.body = Some("x".repeat(MAX_BODY_BYTES + 1));
        assert_eq!(
            authorise(&request),
            Err(ProxyRefusal::BodyTooLarge(MAX_BODY_BYTES + 1))
        );

        request.body = Some("{}".to_owned());
        assert!(authorise(&request).is_ok());

        for content_type in [
            "text/html",
            "application/x-www-form-urlencoded",
            "text/plain",
        ] {
            request
                .headers
                .insert("Content-Type".to_owned(), content_type.to_owned());
            assert_eq!(
                authorise(&request),
                Err(ProxyRefusal::ContentType(content_type.to_owned()))
            );
        }
        // The charset parameter the platform adds is still JSON.
        request.headers.insert(
            "Content-Type".to_owned(),
            "application/json; charset=utf-8".to_owned(),
        );
        assert!(authorise(&request).is_ok());

        // And a GET carries no body at all.
        let mut getter = proxy("GET", "/api/v1/events");
        getter.body = Some("{}".to_owned());
        assert_eq!(authorise(&getter), Err(ProxyRefusal::BodyOnGet));
    }

    #[test]
    fn only_the_three_headers_the_app_sends_are_forwarded() {
        let mut request = proxy("GET", "/api/v1/me");
        request
            .headers
            .insert("Authorization".to_owned(), "Bearer t".to_owned());
        request
            .headers
            .insert("Accept".to_owned(), "application/json".to_owned());
        assert_eq!(
            authorise(&request),
            Ok(("GET".to_owned(), Some("Bearer t")))
        );

        for hostile in ["X-CompIntel-Client", "Host", "Cookie", "X-Forwarded-For"] {
            let mut smuggler = proxy("GET", "/api/v1/me");
            smuggler.headers.insert(hostile.to_owned(), "x".to_owned());
            assert_eq!(
                authorise(&smuggler),
                Err(ProxyRefusal::Header(hostile.to_owned())),
                "{hostile} should be refused"
            );
        }
    }
}
