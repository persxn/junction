//! The READY handshake (ARCHITECTURE.md §3.2, ruling R7): the backend writes
//! exactly one JSON line to stdout and nothing else ever goes there, so the shell
//! reads one line and stops parsing.

use serde::Deserialize;

/// The backend started and is listening.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackendReady {
    pub port: u16,
    pub pid: u32,
    pub app_version: String,
    pub api_version: String,
}

/// Why a line could not be accepted as a successful handshake.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReadyError {
    /// The backend reported `ready:false` with a startup error code (§3.2).
    FailedStart { code: String, message: String },
    /// The line was not the JSON the contract describes.
    Malformed(String),
}

impl std::fmt::Display for ReadyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::FailedStart { code, message } => write!(f, "{code}: {message}"),
            Self::Malformed(detail) => write!(f, "unreadable READY line: {detail}"),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawStartupError {
    code: String,
    message: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawReadyLine {
    ready: bool,
    port: Option<u16>,
    pid: Option<u32>,
    app_version: Option<String>,
    api_version: Option<String>,
    error: Option<RawStartupError>,
}

/// Parses the one line the backend is allowed to print on stdout.
pub fn parse_ready_line(line: &str) -> Result<BackendReady, ReadyError> {
    let raw: RawReadyLine = serde_json::from_str(line.trim())
        .map_err(|cause| ReadyError::Malformed(cause.to_string()))?;

    if !raw.ready {
        let error = raw.error.ok_or_else(|| {
            ReadyError::Malformed("ready:false without an error object".to_owned())
        })?;
        return Err(ReadyError::FailedStart {
            code: error.code,
            message: error.message,
        });
    }

    let port = raw
        .port
        .filter(|port| *port > 0)
        .ok_or_else(|| ReadyError::Malformed("ready:true without a usable port".to_owned()))?;

    Ok(BackendReady {
        port,
        pid: raw.pid.unwrap_or_default(),
        app_version: raw.app_version.unwrap_or_default(),
        api_version: raw.api_version.unwrap_or_default(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_line_the_backend_writes() {
        let line =
            r#"{"ready":true,"port":52991,"pid":19516,"appVersion":"0.1.0","apiVersion":"1.0.0"}"#;
        let ready = parse_ready_line(line).expect("should parse");
        assert_eq!(
            ready,
            BackendReady {
                port: 52991,
                pid: 19516,
                app_version: "0.1.0".to_owned(),
                api_version: "1.0.0".to_owned(),
            }
        );
    }

    #[test]
    fn tolerates_the_trailing_newline_the_pipe_carries() {
        let line =
            "{\"ready\":true,\"port\":1,\"pid\":2,\"appVersion\":\"a\",\"apiVersion\":\"b\"}\r\n";
        assert_eq!(parse_ready_line(line).expect("should parse").port, 1);
    }

    #[test]
    fn surfaces_a_failed_start_with_its_code() {
        let line = r#"{"ready":false,"error":{"code":"DATA_DIR_LOCKED","message":"another backend owns it"}}"#;
        assert_eq!(
            parse_ready_line(line),
            Err(ReadyError::FailedStart {
                code: "DATA_DIR_LOCKED".to_owned(),
                message: "another backend owns it".to_owned(),
            })
        );
    }

    #[test]
    fn rejects_a_ready_line_without_a_port() {
        assert!(matches!(
            parse_ready_line(r#"{"ready":true}"#),
            Err(ReadyError::Malformed(_))
        ));
        assert!(matches!(
            parse_ready_line(r#"{"ready":true,"port":0}"#),
            Err(ReadyError::Malformed(_))
        ));
    }

    #[test]
    fn rejects_anything_that_is_not_the_contract() {
        assert!(matches!(
            parse_ready_line("listening on 3000"),
            Err(ReadyError::Malformed(_))
        ));
        assert!(matches!(
            parse_ready_line(r#"{"ready":false}"#),
            Err(ReadyError::Malformed(_))
        ));
    }
}
