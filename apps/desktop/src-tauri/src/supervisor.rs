//! The backend supervisor (ARCHITECTURE.md §3.2, ADR-0001).
//!
//! One thread owns the lifecycle: spawn with a fresh client secret and `PORT=0`,
//! read the single READY line from stdout, watch the process, and on a crash wait
//! out the backoff and spawn again with a *new* secret and a higher generation.
//! The child's stdin pipe is deliberately left open and never written to - its EOF
//! is how the backend learns the shell is gone (ruling A17) - and every child is
//! assigned to the Job Object, which is the hard guarantee.
//!
//! Nothing here knows about Tauri: the caller passes an observer that is called on
//! every transition, which is what the app turns into an IPC event and what the
//! tests assert on.

use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{Receiver, RecvTimeoutError, channel};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::backoff::{
    BACKOFF_BASE, BACKOFF_MAX, CRASH_WINDOW, CrashLog, MAX_CRASHES_IN_WINDOW, restart_delay,
};
use crate::job::ProcessJob;
use crate::paths::ShellPaths;
use crate::ready::{ReadyError, parse_ready_line};
use crate::secret::client_secret;
use crate::shutdown::request_shutdown;

/// How long the backend has to print its READY line before it counts as a crash.
pub const STARTUP_TIMEOUT: Duration = Duration::from_secs(20);

/// How long "Exit completely" waits after `POST /system/shutdown` (§3.2).
pub const SHUTDOWN_GRACE: Duration = Duration::from_secs(10);

/// How often the child's exit status is checked; Windows has no signal to wait on.
pub const POLL_INTERVAL: Duration = Duration::from_millis(100);

/// The lifecycle phases the UI renders (`BackendPhase` in `packages/contracts`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Phase {
    Starting,
    Ready,
    Restarting,
    Failed,
    Stopping,
    Stopped,
}

/// What `backend_status()` returns (`BackendStatus` in `packages/contracts`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendStatus {
    pub phase: Phase,
    pub generation: u32,
    pub port: Option<u16>,
    pub recent_crashes: usize,
    pub last_error: Option<String>,
    pub data_dir: String,
    pub logs_dir: String,
    pub app_version: String,
}

/// What `backend_connection()` returns (ruling A2).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendConnection {
    pub base_url: String,
    pub client_secret: String,
    pub generation: u32,
}

/// Tunables; the defaults are the numbers §3.2 fixes.
#[derive(Debug, Clone)]
pub struct SupervisorConfig {
    pub paths: ShellPaths,
    pub app_version: String,
    /// Extra backend flags, e.g. `--dev` in a development run.
    pub extra_args: Vec<String>,
    /// Extra environment for the child. The tests use it to point their fake
    /// backend at a scratch file; the app passes none.
    pub extra_env: Vec<(String, String)>,
    pub startup_timeout: Duration,
    pub shutdown_grace: Duration,
    pub poll_interval: Duration,
    pub backoff_base: Duration,
    pub backoff_max: Duration,
    pub crash_window: Duration,
    pub max_crashes: usize,
}

impl SupervisorConfig {
    pub fn new(paths: ShellPaths, app_version: impl Into<String>) -> Self {
        Self {
            paths,
            app_version: app_version.into(),
            extra_args: Vec::new(),
            extra_env: Vec::new(),
            startup_timeout: STARTUP_TIMEOUT,
            shutdown_grace: SHUTDOWN_GRACE,
            poll_interval: POLL_INTERVAL,
            backoff_base: BACKOFF_BASE,
            backoff_max: BACKOFF_MAX,
            crash_window: CRASH_WINDOW,
            max_crashes: MAX_CRASHES_IN_WINDOW,
        }
    }
}

/// Called on every transition. In the app it emits the Tauri event; in tests it
/// records the sequence.
pub type Observer = Arc<dyn Fn(BackendStatus) + Send + Sync>;

struct State {
    phase: Phase,
    generation: u32,
    port: Option<u16>,
    secret: Option<String>,
    last_error: Option<String>,
    crashes: CrashLog,
    child: Option<Child>,
    stop: bool,
    retry: bool,
}

struct Inner {
    config: SupervisorConfig,
    job: ProcessJob,
    observer: Observer,
    state: Mutex<State>,
    wake: Condvar,
}

/// Supervises one backend process for the life of the shell.
pub struct Supervisor {
    inner: Arc<Inner>,
    thread: Mutex<Option<JoinHandle<()>>>,
}

impl Supervisor {
    /// Creates the supervisor and its Job Object. Nothing is spawned until
    /// [`Supervisor::start`] is called.
    pub fn new(config: SupervisorConfig, observer: Observer) -> Result<Self, String> {
        let crashes = CrashLog::with_policy(config.crash_window, config.max_crashes);
        Ok(Self {
            inner: Arc::new(Inner {
                config,
                job: ProcessJob::create()?,
                observer,
                state: Mutex::new(State {
                    phase: Phase::Starting,
                    generation: 0,
                    port: None,
                    secret: None,
                    last_error: None,
                    crashes,
                    child: None,
                    stop: false,
                    retry: false,
                }),
                wake: Condvar::new(),
            }),
            thread: Mutex::new(None),
        })
    }

    /// Starts the supervision thread.
    pub fn start(&self) {
        let inner = Arc::clone(&self.inner);
        let handle = thread::Builder::new()
            .name("backend-supervisor".to_owned())
            .spawn(move || {
                supervise(&inner);
            })
            .expect("the supervisor thread must start");
        *self.thread.lock().expect("supervisor thread lock") = Some(handle);
    }

    /// `<dataDir>\logs`, for the "Open logs" command.
    pub fn logs_dir(&self) -> std::path::PathBuf {
        self.inner.config.paths.logs_dir()
    }

    pub fn status(&self) -> BackendStatus {
        let mut state = self.inner.lock_state();
        self.inner.snapshot(&mut state)
    }

    /// The connection the UI needs, or why there is not one yet (A2).
    pub fn connection(&self) -> Result<BackendConnection, String> {
        let state = self.inner.lock_state();
        match (state.phase, state.port, state.secret.as_ref()) {
            (Phase::Ready, Some(port), Some(secret)) => Ok(BackendConnection {
                base_url: format!("http://127.0.0.1:{port}"),
                client_secret: secret.clone(),
                generation: state.generation,
            }),
            _ => Err(state
                .last_error
                .clone()
                .unwrap_or_else(|| "the backend is not ready".to_owned())),
        }
    }

    /// The "Retry" button: forget the crash history and spawn again.
    pub fn retry(&self) {
        let mut state = self.inner.lock_state();
        state.crashes.clear();
        state.last_error = None;
        state.retry = true;
        self.inner.wake.notify_all();
    }

    /// "Exit completely": ask the backend to stop, wait, then kill the tree.
    /// Returns the HTTP status the backend answered with, when it answered.
    pub fn stop(&self) -> Option<u16> {
        let (port, secret) = {
            let mut state = self.inner.lock_state();
            if state.phase == Phase::Stopped || state.phase == Phase::Stopping {
                return None;
            }
            state.stop = true;
            state.phase = Phase::Stopping;
            let pair = (state.port, state.secret.clone());
            let status = self.inner.snapshot(&mut state);
            drop(state);
            (self.inner.observer)(status);
            pair
        };
        self.inner.wake.notify_all();

        // The HTTP call must not hold the state lock: the supervisor thread needs
        // it to notice the stop flag.
        let answered = match (port, secret) {
            (Some(port), Some(secret)) => {
                request_shutdown(port, &secret, Duration::from_secs(2)).ok()
            }
            _ => None,
        };

        self.inner
            .await_child_exit(Some(self.inner.config.shutdown_grace));
        self.inner.kill_child();
        if let Some(handle) = self.thread.lock().expect("supervisor thread lock").take() {
            let _ = handle.join();
        }
        self.inner.set_phase(Phase::Stopped, None);
        answered
    }
}

impl Drop for Supervisor {
    /// A dropped supervisor must not leave a backend running: the stop flag ends
    /// the thread, the child is killed, and dropping `Inner` closes the Job
    /// Object, which is the hard guarantee for anything the backend spawned.
    fn drop(&mut self) {
        {
            let mut state = self.inner.lock_state();
            state.stop = true;
        }
        self.inner.wake.notify_all();
        self.inner.kill_child();
        if let Some(handle) = self.thread.lock().expect("supervisor thread lock").take() {
            let _ = handle.join();
        }
    }
}

impl Inner {
    fn lock_state(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|poisoned| {
            // A panicked supervisor thread must not deadlock the UI; the state is
            // plain data, so carrying on with it is safe.
            poisoned.into_inner()
        })
    }

    fn snapshot(&self, state: &mut MutexGuard<'_, State>) -> BackendStatus {
        let now = Instant::now();
        BackendStatus {
            phase: state.phase,
            generation: state.generation,
            port: state.port,
            recent_crashes: state.crashes.count(now),
            last_error: state.last_error.clone(),
            data_dir: self.config.paths.data_dir.display().to_string(),
            logs_dir: self.config.paths.logs_dir().display().to_string(),
            app_version: self.config.app_version.clone(),
        }
    }

    fn set_phase(&self, phase: Phase, error: Option<String>) {
        let status = {
            let mut state = self.lock_state();
            state.phase = phase;
            if error.is_some() {
                state.last_error = error;
            }
            if phase != Phase::Ready {
                state.port = None;
            }
            self.snapshot(&mut state)
        };
        (self.observer)(status);
    }

    fn set_ready(&self, port: u16) {
        let status = {
            let mut state = self.lock_state();
            state.phase = Phase::Ready;
            state.port = Some(port);
            state.last_error = None;
            self.snapshot(&mut state)
        };
        (self.observer)(status);
    }

    fn should_stop(&self) -> bool {
        self.lock_state().stop
    }

    /// Waits until `deadline`, or until something asks the thread to wake up.
    fn sleep_interruptible(&self, duration: Duration) {
        let deadline = Instant::now() + duration;
        let mut state = self.lock_state();
        while !state.stop && Instant::now() < deadline {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                break;
            }
            let (guard, _) = self
                .wake
                .wait_timeout(state, remaining)
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            state = guard;
        }
    }

    /// Parks the thread in `FAILED` until "Retry" or shutdown.
    fn await_retry(&self) {
        let mut state = self.lock_state();
        while !state.stop && !state.retry {
            state = self
                .wake
                .wait(state)
                .unwrap_or_else(|poisoned| poisoned.into_inner());
        }
        state.retry = false;
    }

    /// Polls the child until it exits, or until `limit` runs out (`None` waits for
    /// as long as it takes). Windows delivers no signal to wait on, so polling a
    /// process handle every 100 ms is the whole mechanism.
    fn await_child_exit(&self, limit: Option<Duration>) -> Option<i32> {
        let deadline = limit.and_then(|limit| Instant::now().checked_add(limit));
        loop {
            {
                let mut state = self.lock_state();
                match state.child.as_mut().map(Child::try_wait) {
                    None => return None,
                    Some(Ok(Some(status))) => return status.code(),
                    Some(Ok(None)) => {}
                    Some(Err(_)) => return None,
                }
            }
            if deadline.is_some_and(|deadline| Instant::now() >= deadline) {
                return None;
            }
            thread::sleep(self.config.poll_interval);
        }
    }

    fn kill_child(&self) {
        let mut state = self.lock_state();
        if let Some(child) = state.child.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
        state.child = None;
    }
}

/// One spawn: the child plus a channel carrying its stdout lines.
fn spawn_backend(
    config: &SupervisorConfig,
    secret: &str,
) -> std::io::Result<(Child, Receiver<String>)> {
    let mut command = Command::new(&config.paths.node);
    command
        .arg(&config.paths.entry)
        .arg("--data-dir")
        .arg(&config.paths.data_dir)
        // Orphan protection (A17): the backend exits when this pipe reaches EOF.
        .arg("--stdin-lifeline")
        .args(&config.extra_args)
        .env("COMPINTEL_CLIENT_SECRET", secret)
        .env("COMPINTEL_DATA_DIR", &config.paths.data_dir)
        // The OS picks the port and the backend reports it (§3.2).
        .env("PORT", "0")
        .envs(config.extra_env.iter().map(|(key, value)| (key, value)))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        // The backend logs to files (ruling R8); an undrained stderr pipe would
        // eventually block it.
        .stderr(Stdio::null());

    let mut child = command.spawn()?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| std::io::Error::other("the child has no stdout pipe"))?;
    let (sender, receiver) = channel();
    thread::Builder::new()
        .name("backend-stdout".to_owned())
        .spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                // Ruling R7 says only the READY line goes to stdout. Later lines
                // are drained and dropped so the pipe can never fill.
                let _ = sender.send(line);
            }
        })
        .map_err(std::io::Error::other)?;
    Ok((child, receiver))
}

/// Waits for the one line the backend is allowed to print.
fn await_ready(lines: &Receiver<String>, timeout: Duration) -> Result<u16, ReadyError> {
    let deadline = Instant::now() + timeout;
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(ReadyError::Malformed(format!(
                "no READY line within {} s",
                timeout.as_secs()
            )));
        }
        match lines.recv_timeout(remaining) {
            Ok(line) if line.trim().is_empty() => {}
            Ok(line) => return parse_ready_line(&line).map(|ready| ready.port),
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => {
                return Err(ReadyError::Malformed(
                    "the backend closed stdout without a READY line".to_owned(),
                ));
            }
        }
    }
}

/// The supervision loop. Returns when shutdown is requested.
fn supervise(inner: &Arc<Inner>) {
    let mut consecutive: u32 = 0;

    while !inner.should_stop() {
        let secret = match client_secret() {
            Ok(secret) => secret,
            Err(cause) => {
                inner.set_phase(Phase::Failed, Some(cause));
                inner.await_retry();
                continue;
            }
        };

        {
            let mut state = inner.lock_state();
            state.generation += 1;
            state.secret = Some(secret.clone());
        }
        inner.set_phase(Phase::Starting, None);

        let spawned = spawn_backend(&inner.config, &secret);
        let (child, lines) = match spawned {
            Ok(pair) => pair,
            Err(cause) => {
                // A missing node.exe or bundle will not fix itself on a retry.
                inner.set_phase(
                    Phase::Failed,
                    Some(format!(
                        "cannot start {}: {cause}",
                        inner.config.paths.entry.display()
                    )),
                );
                inner.await_retry();
                continue;
            }
        };

        if let Err(cause) = inner.job.assign(&child) {
            // Without the job the orphan guarantee is gone, so this is fatal.
            inner.lock_state().child = Some(child);
            inner.kill_child();
            inner.set_phase(Phase::Failed, Some(cause));
            inner.await_retry();
            continue;
        }
        inner.lock_state().child = Some(child);

        match await_ready(&lines, inner.config.startup_timeout) {
            Ok(port) => {
                consecutive = 0;
                inner.set_ready(port);
                let code = inner.await_child_exit(None);
                if inner.should_stop() {
                    break;
                }
                let detail = code.map_or_else(
                    || "the backend exited".to_owned(),
                    |code| format!("the backend exited with code {code}"),
                );
                inner.kill_child();
                after_crash(inner, &mut consecutive, detail);
            }
            Err(ReadyError::FailedStart { code, message }) => {
                // The backend told us why it cannot run (locked data directory, a
                // failed migration). Restarting would just repeat it.
                inner.kill_child();
                inner.set_phase(Phase::Failed, Some(format!("{code}: {message}")));
                inner.await_retry();
                consecutive = 0;
            }
            Err(other) => {
                inner.kill_child();
                after_crash(inner, &mut consecutive, other.to_string());
            }
        }
    }

    inner.kill_child();
    inner.set_phase(Phase::Stopped, None);
}

/// Records a crash and either parks in `FAILED` or waits out the backoff.
fn after_crash(inner: &Arc<Inner>, consecutive: &mut u32, detail: String) {
    let exhausted = {
        let mut state = inner.lock_state();
        let now = Instant::now();
        state.crashes.record(now);
        state.crashes.is_exhausted(now)
    };
    *consecutive = consecutive.saturating_add(1);

    if exhausted {
        inner.set_phase(
            Phase::Failed,
            Some(format!(
                "{detail}; it crashed {} times in {} minutes",
                inner.config.max_crashes,
                inner.config.crash_window.as_secs() / 60
            )),
        );
        inner.await_retry();
        *consecutive = 0;
        return;
    }

    inner.set_phase(Phase::Restarting, Some(detail));
    inner.sleep_interruptible(restart_delay(
        *consecutive,
        inner.config.backoff_base,
        inner.config.backoff_max,
    ));
}
