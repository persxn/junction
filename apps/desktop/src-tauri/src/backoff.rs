//! Restart policy for the supervised backend (ARCHITECTURE.md §3.2, ADR-0001):
//! exponential backoff 1 s, 2 s, 4 s … capped at 60 s, and a rolling window that
//! stops the retries after 5 crashes in 10 minutes.
//!
//! Everything here is pure arithmetic over `Instant`s so the tests can hand it a
//! timeline instead of sleeping through one.

use std::time::{Duration, Instant};

/// First restart delay.
pub const BACKOFF_BASE: Duration = Duration::from_secs(1);

/// Ceiling of the doubling.
pub const BACKOFF_MAX: Duration = Duration::from_secs(60);

/// How far back crashes are counted.
pub const CRASH_WINDOW: Duration = Duration::from_secs(10 * 60);

/// Crashes inside the window that make the shell give up and show the error screen.
pub const MAX_CRASHES_IN_WINDOW: usize = 5;

/// Delay before restart number `consecutive` (1 = the first restart). `base` and
/// `max` are parameters rather than constants so a test can run the whole ladder
/// in milliseconds instead of minutes.
pub fn restart_delay(consecutive: u32, base: Duration, max: Duration) -> Duration {
    if consecutive == 0 {
        return Duration::ZERO;
    }
    // 2^31 would overflow the multiplication long before the delay matters, so
    // the exponent is clamped well below that.
    let steps = consecutive.saturating_sub(1).min(16);
    base.saturating_mul(1u32 << steps).min(max)
}

/// The crashes seen recently, oldest first.
#[derive(Debug)]
pub struct CrashLog {
    window: Duration,
    limit: usize,
    times: Vec<Instant>,
}

impl CrashLog {
    pub fn new() -> Self {
        Self::with_policy(CRASH_WINDOW, MAX_CRASHES_IN_WINDOW)
    }

    pub fn with_policy(window: Duration, limit: usize) -> Self {
        Self {
            window,
            limit,
            times: Vec::new(),
        }
    }

    /// Records a crash and returns how many are now inside the window.
    pub fn record(&mut self, at: Instant) -> usize {
        self.times.push(at);
        self.prune(at);
        self.times.len()
    }

    /// How many crashes are inside the window as of `now`.
    pub fn count(&mut self, now: Instant) -> usize {
        self.prune(now);
        self.times.len()
    }

    /// True once the window holds enough crashes to stop restarting.
    pub fn is_exhausted(&mut self, now: Instant) -> bool {
        self.count(now) >= self.limit
    }

    /// Forgets the history, which is what "Retry" means.
    pub fn clear(&mut self) {
        self.times.clear();
    }

    fn prune(&mut self, now: Instant) {
        let window = self.window;
        self.times
            .retain(|at| now.saturating_duration_since(*at) < window);
    }
}

impl Default for CrashLog {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn delay(consecutive: u32) -> Duration {
        restart_delay(consecutive, BACKOFF_BASE, BACKOFF_MAX)
    }

    #[test]
    fn doubles_the_delay_up_to_a_minute() {
        assert_eq!(delay(0), Duration::ZERO);
        assert_eq!(delay(1), Duration::from_secs(1));
        assert_eq!(delay(2), Duration::from_secs(2));
        assert_eq!(delay(3), Duration::from_secs(4));
        assert_eq!(delay(4), Duration::from_secs(8));
        assert_eq!(delay(7), Duration::from_secs(60));
        assert_eq!(delay(u32::MAX), Duration::from_secs(60));
    }

    #[test]
    fn honours_a_test_sized_ladder() {
        let base = Duration::from_millis(10);
        let max = Duration::from_millis(40);
        assert_eq!(restart_delay(1, base, max), Duration::from_millis(10));
        assert_eq!(restart_delay(2, base, max), Duration::from_millis(20));
        assert_eq!(restart_delay(9, base, max), max);
    }

    #[test]
    fn counts_only_crashes_inside_the_window() {
        let start = Instant::now();
        let mut log = CrashLog::with_policy(Duration::from_secs(600), 5);

        assert_eq!(log.record(start), 1);
        assert_eq!(log.record(start + Duration::from_secs(30)), 2);
        // Eleven minutes later the first two have fallen out of the window.
        assert_eq!(log.record(start + Duration::from_secs(660)), 1);
    }

    #[test]
    fn gives_up_after_five_crashes_in_ten_minutes() {
        let start = Instant::now();
        let mut log = CrashLog::with_policy(Duration::from_secs(600), 5);
        for index in 0..4 {
            log.record(start + Duration::from_secs(index * 10));
            assert!(!log.is_exhausted(start + Duration::from_secs(index * 10)));
        }
        log.record(start + Duration::from_secs(50));
        assert!(log.is_exhausted(start + Duration::from_secs(50)));
    }

    #[test]
    fn a_slow_crash_loop_never_exhausts_the_window() {
        let start = Instant::now();
        let mut log = CrashLog::with_policy(Duration::from_secs(600), 5);
        for index in 0..20 {
            let at = start + Duration::from_secs(index * 601);
            log.record(at);
            assert!(!log.is_exhausted(at));
        }
    }

    #[test]
    fn retry_forgets_the_history() {
        let now = Instant::now();
        let mut log = CrashLog::with_policy(Duration::from_secs(600), 2);
        log.record(now);
        log.record(now);
        assert!(log.is_exhausted(now));
        log.clear();
        assert!(!log.is_exhausted(now));
        assert_eq!(log.count(now), 0);
    }
}
