pub mod currency;
mod datetime;
mod engine;

use std::borrow::Cow;
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
/// pass on any digit or math character, else on a known first word, else on a
/// bare unit/currency conversion shape ("km to m", "eur to huf").
fn passes_gate(q: &str) -> bool {
    if q.chars().any(|c| c.is_ascii_digit() || "+-*/^%().!".contains(c)) {
        return true;
    }
    if q
        .split_whitespace()
        .next()
        .is_some_and(|w| GATE_KEYWORDS.contains(&w.to_ascii_lowercase().as_str()))
    {
        return true;
    }
    conversion_sides(q.trim()).is_some()
}

/// A single conversion operand: `km`, `eur`, `m/s`, `5km` — one whitespace-free
/// token of alphanumerics plus a few unit symbols.
fn is_unit_token(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 16
        && s.chars().all(|c| c.is_ascii_alphanumeric() || "/^*".contains(c))
}

/// Split `"<lhs> to <rhs>"` / `"<lhs> in <rhs>"` (case-insensitive) into its two
/// single-token operands. Used to recognise a bare conversion missing a leading
/// quantity so it can still reach fend.
fn conversion_sides(t: &str) -> Option<(&str, &str)> {
    for sep in [" to ", " in "] {
        let bytes = t.as_bytes();
        let sb = sep.as_bytes();
        if bytes.len() < sb.len() {
            continue;
        }
        if let Some(i) = (0..=bytes.len() - sb.len())
            .find(|&i| bytes[i..i + sb.len()].eq_ignore_ascii_case(sb))
        {
            let lhs = t[..i].trim();
            let rhs = t[i + sep.len()..].trim();
            if is_unit_token(lhs) && is_unit_token(rhs) {
                return Some((lhs, rhs));
            }
        }
    }
    None
}

/// Prefix `"1 "` to a bare conversion with no leading quantity so fend has
/// something to convert ("km to m" -> "1 km to m", "eur to huf" -> "1 eur to
/// huf"). Anything already carrying a number is left untouched.
fn to_eval_query(q: &str) -> Cow<'_, str> {
    let t = q.trim();
    if let Some((lhs, _)) = conversion_sides(t) {
        if !lhs.starts_with(|c: char| c.is_ascii_digit()) {
            return Cow::Owned(format!("1 {t}"));
        }
    }
    Cow::Borrowed(q)
}

/// Evaluate one expression the way `CalcProvider::search` titles it, returning
/// just the result string. Backs the `calc_eval` command (selection popover
/// math chip); shares the gate/probe/eval path so the two can't drift.
pub fn eval_expression(query: &str, rates: &Arc<RatesCache>, currency_enabled: bool) -> Option<String> {
    let q = query.trim();
    if q.is_empty() || q.len() > 256 || !passes_gate(q) {
        return None;
    }
    if datetime::probe(q) {
        if let Some(dt) = datetime::try_eval(q) {
            return Some(dt.title);
        }
    }
    engine::eval(&to_eval_query(q), rates, currency_enabled)
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
        let eval_q = to_eval_query(q);
        let Some(out) = engine::eval(&eval_q, &self.rates, self.cfg.currency) else {
            return vec![];
        };
        let mut subtitle = eval_q.to_string();
        if self.cfg.currency && mentions_currency(&eval_q, &self.rates) {
            let stale = self.rates.age_secs().is_none_or(|age| age > 24 * 3600);
            if stale {
                if let Some(date) = self.rates.fetched_date() {
                    subtitle = format!("{eval_q} · rates from {date}");
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
        for q in [
            "2+2", "pi", "pi * 2", "time in tokyo", "5km to mi", "days until dec 25",
            "now + 3 weeks", "sqrt(2)", "km to m", "eur to huf", "usd in gbp",
        ] {
            assert!(passes_gate(q), "should pass: {q}");
        }
        // must be rejected (app-name keystrokes)
        for q in ["firefox", "settings", "code", "files"] {
            assert!(!passes_gate(q), "should reject: {q}");
        }
    }

    #[test]
    fn bare_conversion_gets_unit_quantity() {
        // no leading number -> prefix "1 " so fend has something to convert
        assert_eq!(to_eval_query("km to m"), "1 km to m");
        assert_eq!(to_eval_query("eur to huf"), "1 eur to huf");
        // already carries a quantity -> untouched
        assert_eq!(to_eval_query("5km to mi"), "5km to mi");
        assert_eq!(to_eval_query("100 usd to eur"), "100 usd to eur");
        // not a conversion -> untouched
        assert_eq!(to_eval_query("2+2"), "2+2");
    }

    #[test]
    fn eval_expression_agrees_with_search() {
        let rates: Arc<RatesCache> =
            Arc::new(RatesCache::with_rates([("USD".into(), 1.0), ("EUR".into(), 0.5)].into(), 0));
        let provider = CalcProvider::new(&CalcConfig::default(), Arc::clone(&rates));
        for q in ["2+2", "time in tokyo", "5km to mi", "100 usd to eur"] {
            assert_eq!(
                eval_expression(q, &rates, true).as_deref(),
                Some(provider.search(q)[0].title.as_str()),
                "drifted for: {q}"
            );
        }
        assert_eq!(eval_expression("hello world", &rates, true), None);
        assert_eq!(eval_expression("", &rates, true), None);
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
        // bare conversions assume a unit quantity
        assert!(provider.search("km to m")[0].title.contains("m"));
        // 1 eur = 2 usd (EUR base 0.5, USD base 1.0); subtitle shows normalized query
        let c = &provider.search("eur to usd")[0];
        assert!(c.title.contains('2'), "got: {}", c.title);
        assert_eq!(c.subtitle.as_deref(), Some("1 eur to usd"));
        // currency result with never-fetched rates carries no provenance (no date known)
        let r = &provider.search("100 usd to eur")[0];
        assert!(r.title.contains("50"));
        assert!(provider.search("firefox").is_empty());
    }
}
