//! What WP-05a's acceptance criteria actually ask for: kill the backend and it
//! comes back with a new secret, and exiting leaves no processes behind.
//!
//! The "backend" here is a few lines of JavaScript run by the same Node the shell
//! would use, so the handshake, the pipes, the Job Object and the restart ladder
//! are all the real ones - only the Fastify app is missing.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use compintel_lib::paths::ShellPaths;
use compintel_lib::supervisor::{BackendStatus, Phase, Supervisor, SupervisorConfig};

/// A fake backend that prints the READY line and then waits for stdin to close,
/// exactly as the real one does with `--stdin-lifeline`.
const READY_AND_WAIT: &str = r#"
const fs = require('node:fs');
const marker = process.env.FAKE_MARKER;
if (marker) { fs.writeFileSync(marker, String(process.pid)); }
const secretFile = process.env.FAKE_SECRET_LOG;
if (secretFile) {
  fs.appendFileSync(secretFile, `${process.env.COMPINTEL_CLIENT_SECRET}\n`);
}
process.stdout.write(JSON.stringify({
  ready: true, port: 45001, pid: process.pid, appVersion: '0.1.0', apiVersion: '1.0.0',
}) + '\n');
process.stdin.resume();
process.stdin.on('end', () => process.exit(0));
setInterval(() => {}, 1000);
"#;

/// A fake backend that starts, says it is ready, then dies on its own.
const READY_THEN_DIE: &str = r#"
const fs = require('node:fs');
const log = process.env.FAKE_SECRET_LOG;
if (log) { fs.appendFileSync(log, `${process.env.COMPINTEL_CLIENT_SECRET}\n`); }
process.stdout.write(JSON.stringify({
  ready: true, port: 45002, pid: process.pid, appVersion: '0.1.0', apiVersion: '1.0.0',
}) + '\n');
setTimeout(() => process.exit(3), 30);
"#;

/// A fake backend that refuses to start, the way a locked data directory does.
const FAILED_START: &str = r#"
process.stdout.write(JSON.stringify({
  ready: false, error: { code: 'DATA_DIR_LOCKED', message: 'another backend owns it' },
}) + '\n');
process.exit(1);
"#;

/// Test scratch space: `%LOCALAPPDATA%\CompIntel-dev\test-tmp` (CLAUDE.md keeps
/// every byte of dev data out of the repository and out of the system temp folder).
fn temp_dir(name: &str) -> PathBuf {
    let base = std::env::var("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| std::env::temp_dir());
    let dir = base
        .join("CompIntel-dev")
        .join("test-tmp")
        .join(format!("shell-{name}-{}", std::process::id()));
    fs::create_dir_all(&dir).expect("scratch directory");
    dir
}

fn write_script(dir: &Path, body: &str) -> PathBuf {
    let file = dir.join("fake-backend.cjs");
    fs::write(&file, body).expect("write the fake backend");
    file
}

struct Harness {
    supervisor: Supervisor,
    seen: Arc<Mutex<Vec<BackendStatus>>>,
    dir: PathBuf,
}

fn harness(name: &str, script: &str, tweak: impl FnOnce(&mut SupervisorConfig)) -> Harness {
    let dir = temp_dir(name);
    let entry = write_script(&dir, script);
    let paths = ShellPaths {
        data_dir: dir.join("data"),
        node: PathBuf::from("node"),
        entry,
    };

    let mut config = SupervisorConfig::new(paths, "0.1.0");
    config.startup_timeout = Duration::from_secs(10);
    config.poll_interval = Duration::from_millis(20);
    config.backoff_base = Duration::from_millis(20);
    config.backoff_max = Duration::from_millis(80);
    config.shutdown_grace = Duration::from_secs(2);
    // Per-child environment rather than `std::env::set_var`: cargo runs these
    // tests as threads of one process, so a shared variable would race.
    config.extra_env = vec![
        (
            "FAKE_SECRET_LOG".to_owned(),
            dir.join("secrets.log").display().to_string(),
        ),
        (
            "FAKE_MARKER".to_owned(),
            dir.join("pid.txt").display().to_string(),
        ),
    ];
    tweak(&mut config);

    let seen: Arc<Mutex<Vec<BackendStatus>>> = Arc::new(Mutex::new(Vec::new()));
    let recorder = Arc::clone(&seen);
    let supervisor = Supervisor::new(
        config,
        Arc::new(move |status| {
            recorder.lock().expect("observer lock").push(status);
        }),
    )
    .expect("the supervisor is created");

    Harness {
        supervisor,
        seen,
        dir,
    }
}

impl Harness {
    fn phases(&self) -> Vec<Phase> {
        self.seen
            .lock()
            .expect("observer lock")
            .iter()
            .map(|status| status.phase)
            .collect()
    }

    /// Waits for a predicate on the current status, or gives up.
    fn wait_for(
        &self,
        limit: Duration,
        predicate: impl Fn(&BackendStatus) -> bool,
    ) -> BackendStatus {
        let deadline = Instant::now() + limit;
        loop {
            let status = self.supervisor.status();
            if predicate(&status) {
                return status;
            }
            assert!(
                Instant::now() < deadline,
                "timed out waiting; phases so far: {:?}, last status {:?}",
                self.phases(),
                status
            );
            std::thread::sleep(Duration::from_millis(20));
        }
    }
}

fn secrets_logged(dir: &Path) -> Vec<String> {
    fs::read_to_string(dir.join("secrets.log"))
        .unwrap_or_default()
        .lines()
        .map(str::to_owned)
        .filter(|line| !line.is_empty())
        .collect()
}

fn is_running(pid: u32) -> bool {
    let output = Command::new("tasklist")
        .args(["/FI", &format!("PID eq {pid}"), "/NH"])
        .output()
        .expect("tasklist runs on Windows");
    String::from_utf8_lossy(&output.stdout).contains(&pid.to_string())
}

#[test]
fn reaches_ready_and_hands_the_ui_a_connection() {
    let harness = harness("ready", READY_AND_WAIT, |_| {});
    harness.supervisor.start();

    let status = harness.wait_for(Duration::from_secs(15), |s| s.phase == Phase::Ready);
    assert_eq!(status.generation, 1);
    assert_eq!(status.port, Some(45001));
    assert_eq!(status.recent_crashes, 0);

    let connection = harness.supervisor.connection().expect("a connection");
    assert_eq!(connection.base_url, "http://127.0.0.1:45001");
    assert_eq!(connection.generation, 1);
    assert_eq!(connection.client_secret.len(), 64);
    assert!(
        connection
            .client_secret
            .chars()
            .all(|c| c.is_ascii_hexdigit())
    );

    harness.supervisor.stop();
    assert_eq!(harness.phases().first(), Some(&Phase::Starting));
}

#[test]
fn restarts_a_crashed_backend_with_a_new_secret_and_generation() {
    let harness = harness("restart", READY_THEN_DIE, |config| {
        config.max_crashes = 10;
    });
    harness.supervisor.start();
    let status = harness.wait_for(Duration::from_secs(20), |s| s.generation >= 3);
    assert!(status.recent_crashes >= 2, "status was {status:?}");

    harness.supervisor.stop();

    let secrets = secrets_logged(&harness.dir);
    assert!(secrets.len() >= 3, "only saw {secrets:?}");
    let unique: std::collections::HashSet<&String> = secrets.iter().collect();
    assert_eq!(
        unique.len(),
        secrets.len(),
        "every spawn must get a new client secret (A2): {secrets:?}"
    );
    assert!(harness.phases().contains(&Phase::Restarting));
}

#[test]
fn gives_up_after_too_many_crashes_and_retries_when_asked() {
    let harness = harness("giveup", READY_THEN_DIE, |config| {
        config.max_crashes = 3;
        config.crash_window = Duration::from_secs(60);
    });
    harness.supervisor.start();

    let failed = harness.wait_for(Duration::from_secs(20), |s| s.phase == Phase::Failed);
    assert_eq!(failed.recent_crashes, 3);
    assert!(
        failed
            .last_error
            .as_deref()
            .unwrap_or_default()
            .contains("crashed 3 times"),
        "unhelpful message: {:?}",
        failed.last_error
    );
    assert!(harness.supervisor.connection().is_err());

    let before = harness.supervisor.status().generation;
    harness.supervisor.retry();
    harness.wait_for(Duration::from_secs(10), |s| s.generation > before);

    harness.supervisor.stop();
}

#[test]
fn a_refused_start_is_reported_verbatim_and_not_retried() {
    let harness = harness("failedstart", FAILED_START, |_| {});
    harness.supervisor.start();

    let failed = harness.wait_for(Duration::from_secs(15), |s| s.phase == Phase::Failed);
    assert_eq!(
        failed.last_error.as_deref(),
        Some("DATA_DIR_LOCKED: another backend owns it")
    );
    // One spawn, then it stopped trying: a locked data directory will not unlock
    // itself, so a backoff loop would only hide the message.
    assert_eq!(failed.generation, 1);
    assert_eq!(failed.recent_crashes, 0);

    harness.supervisor.stop();
}

#[test]
fn a_backend_that_never_says_ready_counts_as_a_crash() {
    let harness = harness("silent", "setInterval(() => {}, 1000);", |config| {
        config.startup_timeout = Duration::from_millis(300);
        config.max_crashes = 2;
    });
    harness.supervisor.start();

    let failed = harness.wait_for(Duration::from_secs(15), |s| s.phase == Phase::Failed);
    assert_eq!(failed.recent_crashes, 2);
    assert!(
        failed
            .last_error
            .as_deref()
            .unwrap_or_default()
            .contains("no READY line"),
        "unhelpful message: {:?}",
        failed.last_error
    );

    harness.supervisor.stop();
}

#[test]
fn stopping_leaves_no_backend_process_behind() {
    let harness = harness("stop", READY_AND_WAIT, |_| {});
    let marker = harness.dir.join("pid.txt");
    let _ = fs::remove_file(&marker);

    harness.supervisor.start();
    harness.wait_for(Duration::from_secs(15), |s| s.phase == Phase::Ready);

    let pid: u32 = fs::read_to_string(&marker)
        .expect("the fake backend wrote its pid")
        .trim()
        .parse()
        .expect("a pid");
    assert!(is_running(pid), "the fake backend should be running");

    harness.supervisor.stop();
    assert_eq!(harness.supervisor.status().phase, Phase::Stopped);

    // The shutdown request goes to a port nothing is listening on, so this is the
    // kill-the-tree path: it still has to leave nothing running.
    let deadline = Instant::now() + Duration::from_secs(5);
    while is_running(pid) && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(50));
    }
    assert!(!is_running(pid), "pid {pid} outlived the shell");
}

#[test]
fn dropping_the_supervisor_leaves_no_orphan() {
    let harness = harness("joborphan", READY_AND_WAIT, |_| {});
    let marker = harness.dir.join("pid.txt");
    let _ = fs::remove_file(&marker);

    harness.supervisor.start();
    harness.wait_for(Duration::from_secs(15), |s| s.phase == Phase::Ready);
    let pid: u32 = fs::read_to_string(&marker)
        .expect("pid file")
        .trim()
        .parse()
        .expect("a pid");

    // No stop() and no shutdown request: the supervisor is simply dropped. Its
    // Drop ends the thread and kills the child, and releasing the last Arc closes
    // the Job Object, which is what also covers anything the backend spawned
    // (`llama-server`, headless Edge). `job.rs` tests the job close on its own.
    let Harness { supervisor, .. } = harness;
    drop(supervisor);

    let deadline = Instant::now() + Duration::from_secs(5);
    while is_running(pid) && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(50));
    }
    assert!(!is_running(pid), "pid {pid} survived the shell going away");
}
