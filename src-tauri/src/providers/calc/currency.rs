use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, OnceLock, RwLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

/// USD-based exchange rates, refreshed off the search path and cached on disk
/// so the calc provider works offline with the last known rates.
pub struct RatesCache {
    rates: RwLock<HashMap<String, f64>>,
    /// Unix seconds of the last successful fetch; 0 = never fetched.
    fetched_at: AtomicI64,
}

#[derive(Serialize, Deserialize)]
struct RatesFile {
    fetched_at: i64,
    base: String,
    rates: HashMap<String, f64>,
}

const PRIMARY_URL: &str = "https://open.er-api.com/v6/latest/USD";
const FALLBACK_URL: &str = "https://api.frankfurter.dev/v1/latest?from=USD";
const FETCH_TIMEOUT: Duration = Duration::from_secs(10);

fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn cache_path() -> PathBuf {
    crate::paths::data_dir().join("currency_rates.json")
}

/// Process-wide rate cache, shared by the provider and the refresh thread so
/// config-driven provider rebuilds keep the already-fetched rates.
pub fn shared() -> Arc<RatesCache> {
    static RATES: OnceLock<Arc<RatesCache>> = OnceLock::new();
    Arc::clone(RATES.get_or_init(|| Arc::new(RatesCache::load_from_disk())))
}

impl RatesCache {
    pub fn empty() -> Self {
        Self {
            rates: RwLock::new(HashMap::new()),
            fetched_at: AtomicI64::new(0),
        }
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub fn with_rates(rates: HashMap<String, f64>, fetched_at: i64) -> Self {
        Self {
            rates: RwLock::new(rates),
            fetched_at: AtomicI64::new(fetched_at),
        }
    }

    pub fn load_from_disk() -> Self {
        let cache = Self::empty();
        if let Ok(bytes) = std::fs::read(cache_path()) {
            if let Ok(file) = serde_json::from_slice::<RatesFile>(&bytes) {
                *cache.rates.write().unwrap() = file.rates;
                cache.fetched_at.store(file.fetched_at, Ordering::Relaxed);
            }
        }
        cache
    }

    /// Rate of `currency` relative to USD. Case-insensitive.
    pub fn rate(&self, currency: &str) -> Option<f64> {
        self.rates
            .read()
            .unwrap()
            .get(&currency.to_ascii_uppercase())
            .copied()
    }

    pub fn is_empty(&self) -> bool {
        self.rates.read().unwrap().is_empty()
    }

    pub fn age_secs(&self) -> Option<i64> {
        match self.fetched_at.load(Ordering::Relaxed) {
            0 => None,
            t => Some(now_unix() - t),
        }
    }

    /// Human date ("2026-07-03") of the last successful fetch, for provenance.
    pub fn fetched_date(&self) -> Option<String> {
        match self.fetched_at.load(Ordering::Relaxed) {
            0 => None,
            t => {
                use chrono::{Local, TimeZone};
                Local
                    .timestamp_opt(t, 0)
                    .single()
                    .map(|dt| dt.format("%Y-%m-%d").to_string())
            }
        }
    }

    /// Fetch fresh rates (primary, then fallback endpoint) and persist to disk.
    pub fn refresh(&self) -> Result<(), String> {
        let rates = fetch(PRIMARY_URL).or_else(|e| {
            eprintln!("[calc] primary rate source failed: {e}");
            fetch(FALLBACK_URL)
        })?;
        let fetched_at = now_unix();
        let file = RatesFile {
            fetched_at,
            base: "USD".to_string(),
            rates: rates.clone(),
        };
        *self.rates.write().unwrap() = rates;
        self.fetched_at.store(fetched_at, Ordering::Relaxed);
        // Atomic-rename write so a crash mid-write can't corrupt the cache.
        let path = cache_path();
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let tmp = path.with_extension("json.tmp");
        if let Ok(json) = serde_json::to_vec(&file) {
            if std::fs::write(&tmp, json).is_ok() {
                let _ = std::fs::rename(&tmp, &path);
            }
        }
        Ok(())
    }
}

fn fetch(url: &str) -> Result<HashMap<String, f64>, String> {
    #[derive(Deserialize)]
    struct Response {
        rates: HashMap<String, f64>,
    }
    let resp = ureq::get(url)
        .timeout(FETCH_TIMEOUT)
        .call()
        .map_err(|e| e.to_string())?;
    let parsed: Response =
        serde_json::from_reader(resp.into_reader()).map_err(|e| e.to_string())?;
    if parsed.rates.is_empty() {
        return Err("empty rate table".to_string());
    }
    let mut rates: HashMap<String, f64> = parsed
        .rates
        .into_iter()
        .map(|(k, v)| (k.to_ascii_uppercase(), v))
        .collect();
    rates.insert("USD".to_string(), 1.0); // frankfurter omits the base itself
    Ok(rates)
}

/// Background refresher: fetch when the cache is missing or older than
/// `max_age_hours`, then re-check periodically. Failures keep the stale cache.
pub fn spawn_refresh_thread(rates: Arc<RatesCache>, max_age_hours: u64) {
    std::thread::spawn(move || loop {
        let max_age = (max_age_hours * 3600) as i64;
        let stale = rates.age_secs().is_none_or(|age| age >= max_age);
        if stale || rates.is_empty() {
            if let Err(e) = rates.refresh() {
                eprintln!("[calc] exchange rate refresh failed (serving cached rates): {e}");
            }
        }
        std::thread::sleep(Duration::from_secs(6 * 3600));
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rate_lookup_case_insensitive() {
        let cache = RatesCache::with_rates([("EUR".to_string(), 0.9)].into(), now_unix());
        assert_eq!(cache.rate("eur"), Some(0.9));
        assert_eq!(cache.rate("EUR"), Some(0.9));
        assert_eq!(cache.rate("XXX"), None);
    }

    #[test]
    fn staleness() {
        let fresh = RatesCache::with_rates([("EUR".to_string(), 0.9)].into(), now_unix());
        assert!(fresh.age_secs().unwrap() < 60);
        let never = RatesCache::empty();
        assert_eq!(never.age_secs(), None);
        assert_eq!(never.fetched_date(), None);
    }

    #[test]
    #[ignore = "network: run manually with cargo test -- --ignored"]
    fn live_fetch_both_endpoints() {
        for url in [PRIMARY_URL, FALLBACK_URL] {
            let rates = fetch(url).unwrap_or_else(|e| panic!("{url}: {e}"));
            assert!(rates.get("EUR").is_some_and(|r| *r > 0.0), "{url}");
            assert_eq!(rates.get("USD"), Some(&1.0), "{url}");
        }
    }

    #[test]
    fn rates_file_roundtrip() {
        let file = RatesFile {
            fetched_at: 123,
            base: "USD".to_string(),
            rates: [("EUR".to_string(), 0.9)].into(),
        };
        let json = serde_json::to_vec(&file).unwrap();
        let back: RatesFile = serde_json::from_slice(&json).unwrap();
        assert_eq!(back.fetched_at, 123);
        assert_eq!(back.rates["EUR"], 0.9);
    }
}
