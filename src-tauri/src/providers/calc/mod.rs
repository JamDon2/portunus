pub mod currency;
mod datetime;
mod engine;

use std::sync::Arc;

use currency::RatesCache;

use super::{Provider, SearchResult};
use crate::config::CalcConfig;

pub struct CalcProvider {
    rates: Arc<RatesCache>,
    cfg: CalcConfig,
}

impl CalcProvider {
    pub fn new(cfg: &CalcConfig, rates: Arc<RatesCache>) -> Self {
        Self {
            rates,
            cfg: cfg.clone(),
        }
    }
}

/// Wordy queries that must still reach the calculator ("pi", "time in tokyo").
const GATE_KEYWORDS: &[&str] = &[
    "now", "today", "tomorrow", "time", "days", "utc", "gmt", "pi", "sqrt", "sin", "cos", "tan",
    "log", "ln",
];

/// Cheap early exit so plain app-name keystrokes never hit the parsers:
/// pass on any digit or math character, else on a known first word.
fn passes_gate(q: &str) -> bool {
    if q.chars().any(|c| c.is_ascii_digit() || "+-*/^%().!".contains(c)) {
        return true;
    }
    q.split_whitespace()
        .next()
        .is_some_and(|w| GATE_KEYWORDS.contains(&w.to_ascii_lowercase().as_str()))
}

fn make_result(title: String, subtitle: String) -> SearchResult {
    SearchResult {
        id: "calc:result".to_string(),
        title,
        subtitle: Some(subtitle),
        kind: "calc".to_string(),
        score: super::SCORE_CALC,
        ..Default::default()
    }
}

/// True when the query mentions a known currency code ("100 usd to eur"),
/// so staleness provenance only shows up on currency results.
fn mentions_currency(q: &str, rates: &RatesCache) -> bool {
    q.split(|c: char| !c.is_ascii_alphabetic())
        .filter(|t| t.len() == 3)
        .any(|t| rates.rate(t).is_some())
}

impl Provider for CalcProvider {
    fn id(&self) -> &str {
        "calc"
    }

    fn search(&self, query: &str) -> Vec<SearchResult> {
        let q = query.trim();
        if q.is_empty() || !passes_gate(q) {
            return vec![];
        }
        if datetime::probe(q) {
            if let Some(dt) = datetime::try_eval(q) {
                return vec![make_result(dt.title, dt.subtitle)];
            }
        }
        let Some(out) = engine::eval(q, &self.rates, self.cfg.currency) else {
            return vec![];
        };
        let mut subtitle = q.to_string();
        if self.cfg.currency && mentions_currency(q, &self.rates) {
            let stale = self.rates.age_secs().is_none_or(|age| age > 24 * 3600);
            if stale {
                if let Some(date) = self.rates.fetched_date() {
                    subtitle = format!("{q} · rates from {date}");
                }
            }
        }
        vec![make_result(out, subtitle)]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gate() {
        // must pass
        for q in ["2+2", "pi", "pi * 2", "time in tokyo", "5km to mi", "days until dec 25", "now + 3 weeks", "sqrt(2)"] {
            assert!(passes_gate(q), "should pass: {q}");
        }
        // must be rejected (app-name keystrokes)
        for q in ["firefox", "settings", "code", "files"] {
            assert!(!passes_gate(q), "should reject: {q}");
        }
    }

    #[test]
    fn end_to_end_dispatch() {
        let provider = CalcProvider::new(
            &CalcConfig::default(),
            Arc::new(RatesCache::with_rates([("USD".into(), 1.0), ("EUR".into(), 0.5)].into(), 0)),
        );
        assert_eq!(provider.search("2+2")[0].title, "4");
        assert!(provider.search("time in tokyo")[0].subtitle.as_deref().unwrap().starts_with("Asia/Tokyo"));
        assert!(provider.search("5km to mi")[0].title.contains("mi"));
        // currency result with never-fetched rates carries no provenance (no date known)
        let r = &provider.search("100 usd to eur")[0];
        assert!(r.title.contains("50"));
        assert!(provider.search("firefox").is_empty());
    }
}
