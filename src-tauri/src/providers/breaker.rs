//! Half-open circuit breaker for interactive extension calls.
//!
//! Repeated consecutive failures pause the extension for an escalating
//! cooldown (30 s -> 2 min -> 10 min per episode) instead of benching it for
//! the whole session: transient failures (a flaky API, a network blip)
//! recover on their own, while a genuinely broken extension settles into the
//! longest cooldown. When a cooldown expires the breaker is half-open - one
//! call is let through; success resets everything, failure re-benches
//! immediately at the next escalation step.
//!
//! Callers pass the current time in unix milliseconds, which keeps the type
//! trivially testable.

use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};

/// Escalating pause per bench episode; further episodes reuse the last entry.
const COOLDOWNS_MS: [u64; 3] = [30_000, 120_000, 600_000];

pub struct FailureBreaker {
    /// Consecutive failures in the current streak.
    fail_count: AtomicU32,
    /// Unix ms until which calls are rejected; 0 = closed (healthy).
    benched_until: AtomicU64,
    /// Completed bench episodes - indexes the cooldown escalation.
    episodes: AtomicU32,
}

impl FailureBreaker {
    pub const fn new() -> Self {
        Self {
            fail_count: AtomicU32::new(0),
            benched_until: AtomicU64::new(0),
            episodes: AtomicU32::new(0),
        }
    }

    /// True while the breaker rejects calls. An expired deadline means
    /// half-open: the call goes through and the next success/failure decides.
    pub fn is_open(&self, now_ms: u64) -> bool {
        now_ms < self.benched_until.load(Ordering::Relaxed)
    }

    /// A call ran cleanly - close the breaker and forget the history.
    pub fn on_success(&self) {
        self.fail_count.store(0, Ordering::Relaxed);
        self.benched_until.store(0, Ordering::Relaxed);
        self.episodes.store(0, Ordering::Relaxed);
    }

    /// Records one failure. Returns the cooldown just started (ms) when this
    /// failure tripped the breaker, None while below the threshold.
    pub fn on_failure(&self, now_ms: u64, threshold: u32) -> Option<u64> {
        let fails = self.fail_count.fetch_add(1, Ordering::Relaxed) + 1;
        if fails < threshold {
            return None;
        }
        let episode = self.episodes.fetch_add(1, Ordering::Relaxed) as usize;
        let cooldown = COOLDOWNS_MS[episode.min(COOLDOWNS_MS.len() - 1)];
        self.benched_until.store(now_ms + cooldown, Ordering::Relaxed);
        Some(cooldown)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const T: u32 = 3;

    #[test]
    fn trips_after_threshold_and_recovers_after_cooldown() {
        let b = FailureBreaker::new();
        assert_eq!(b.on_failure(1_000, T), None);
        assert_eq!(b.on_failure(1_000, T), None);
        assert_eq!(b.on_failure(1_000, T), Some(30_000));
        assert!(b.is_open(1_000));
        assert!(b.is_open(30_999));
        // Cooldown expired: half-open, calls allowed again.
        assert!(!b.is_open(31_000));
    }

    #[test]
    fn half_open_failure_rebenches_with_escalation() {
        let b = FailureBreaker::new();
        for _ in 0..3 {
            b.on_failure(0, T);
        }
        // Streak is still at/above threshold: the probe failure re-benches
        // immediately with the next cooldown.
        assert_eq!(b.on_failure(30_000, T), Some(120_000));
        assert!(b.is_open(30_000 + 119_999));
        assert_eq!(b.on_failure(200_000, T), Some(600_000));
        // Escalation saturates at the last entry.
        assert_eq!(b.on_failure(900_000, T), Some(600_000));
    }

    #[test]
    fn success_resets_everything() {
        let b = FailureBreaker::new();
        for _ in 0..3 {
            b.on_failure(0, T);
        }
        b.on_success();
        assert!(!b.is_open(0));
        // A fresh streak starts from zero and the escalation restarts.
        assert_eq!(b.on_failure(50_000, T), None);
        assert_eq!(b.on_failure(50_000, T), None);
        assert_eq!(b.on_failure(50_000, T), Some(30_000));
    }
}
