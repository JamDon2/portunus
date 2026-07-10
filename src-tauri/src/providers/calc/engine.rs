use std::sync::Arc;
use std::time::{Duration, Instant};

use super::currency::RatesCache;

/// Hard cap on a single fend evaluation so pathological input
/// (e.g. `10^10^10^10`) can't stall the keystroke thread.
const EVAL_DEADLINE: Duration = Duration::from_millis(50);

struct Deadline(Instant);

impl fend_core::Interrupt for Deadline {
    fn should_interrupt(&self) -> bool {
        Instant::now() >= self.0
    }
}

struct RatesHandler(Arc<RatesCache>);

impl fend_core::ExchangeRateFnV2 for RatesHandler {
    fn relative_to_base_currency(
        &self,
        currency: &str,
        _options: &fend_core::ExchangeRateFnV2Options,
    ) -> Result<f64, Box<dyn std::error::Error + Send + Sync + 'static>> {
        self.0.rate(currency).ok_or_else(|| format!("unknown currency: {currency}").into())
    }
}

/// fend only knows `log` (base 10), `log10`, `log2`, and `ln`. Rewrite an
/// arbitrary-base `logN(...)` into a change-of-base lambda so `log3(27)` works.
/// fend applies lambdas by juxtaposition, so this also covers `log3 27`.
/// `log2`/`log10` are left untouched to keep fend's exact native results.
fn rewrite_log_base(query: &str) -> String {
    let bytes = query.as_bytes();
    let mut out = String::with_capacity(query.len());
    let mut i = 0;
    while i < bytes.len() {
        // Match "log" only on a word boundary (prev char not alphanumeric/_).
        let boundary = i == 0 || {
            let p = bytes[i - 1];
            !(p.is_ascii_alphanumeric() || p == b'_')
        };
        if boundary && query[i..].starts_with("log") {
            let after = i + 3;
            let digits_end = after + bytes[after..].iter().take_while(|b| b.is_ascii_digit()).count();
            let base = &query[after..digits_end];
            // Require digits, and don't touch fend's native log2/log10.
            if !base.is_empty() && base != "2" && base != "10" {
                out.push_str(&format!("(x:(ln x)/(ln {base}))"));
                i = digits_end;
                continue;
            }
        }
        // Copy one full char (handle multi-byte UTF-8).
        let ch_len = query[i..].chars().next().map_or(1, char::len_utf8);
        out.push_str(&query[i..i + ch_len]);
        i += ch_len;
    }
    out
}

/// Trim trailing zeros (and a dangling dot) from a result that is a bare
/// decimal number, so `3.0000000000` -> `3` and `2.5000` -> `2.5`. Anything
/// carrying a unit or symbol is left untouched.
fn trim_decimal_zeros(out: &str) -> &str {
    let body = out.strip_prefix('-').unwrap_or(out);
    if !body.contains('.') || !body.bytes().all(|b| b.is_ascii_digit() || b == b'.') {
        return out;
    }
    out.trim_end_matches('0').trim_end_matches('.')
}

pub fn eval(query: &str, rates: &Arc<RatesCache>, currency_enabled: bool) -> Option<String> {
    // Context::new() is cheap (empty maps); fend's unit tables are static.
    let mut ctx = fend_core::Context::new();
    if currency_enabled {
        ctx.set_exchange_rate_handler_v2(RatesHandler(Arc::clone(rates)));
    }
    let rewritten = rewrite_log_base(query);
    let interrupt = Deadline(Instant::now() + EVAL_DEADLINE);
    let result = fend_core::evaluate_with_interrupt(&rewritten, &mut ctx, &interrupt).ok()?;
    if result.output_is_empty() {
        return None;
    }
    let out = result.get_main_result().trim();
    // fend prefixes approximate decimals with "approx. " - drop it.
    let out = out.strip_prefix("approx. ").unwrap_or(out);
    // Bare identifiers/units echo back unchanged ("km" -> "km") - not a result.
    if out.is_empty() || out == query.trim() {
        return None;
    }
    // Change-of-base log lambdas fuzz an exact answer into "3.0000000000".
    // If the whole result is a plain decimal, drop trailing fractional zeros.
    let out = trim_decimal_zeros(out);
    Some(out.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn eval_plain(q: &str) -> Option<String> {
        eval(q, &Arc::new(RatesCache::empty()), false)
    }

    #[test]
    fn arithmetic() {
        assert_eq!(eval_plain("2+2").as_deref(), Some("4"));
        assert_eq!(eval_plain("2^10").as_deref(), Some("1024"));
    }

    #[test]
    fn sci_functions_and_constants() {
        assert_eq!(eval_plain("sqrt(4)").as_deref(), Some("2"));
        assert_eq!(eval_plain("5!").as_deref(), Some("120"));
        assert_eq!(eval_plain("6 choose 2").as_deref(), Some("15"));
        assert_eq!(eval_plain("sin(pi/2)").as_deref(), Some("1"));
        assert!(eval_plain("pi").unwrap().contains("3.1415926536"));
        assert!(eval_plain("log(100)").is_some());
    }

    #[test]
    fn arbitrary_base_log() {
        assert_eq!(eval_plain("log3(27)").as_deref(), Some("3"));
        assert_eq!(eval_plain("log3 27").as_deref(), Some("3"));
        assert_eq!(eval_plain("log5(125)").as_deref(), Some("3"));
        // native log2/log10 still exact
        assert_eq!(eval_plain("log2(8)").as_deref(), Some("3"));
        assert_eq!(eval_plain("log10(1000)").as_deref(), Some("3"));
        // bare log/ln untouched
        assert!(eval_plain("log(100)").is_some());
    }

    #[test]
    fn approx_prefix_stripped() {
        assert!(eval_plain("1/3").unwrap().starts_with("0.3"));
        assert!(eval_plain("pi").unwrap().starts_with("3.14"));
    }

    #[test]
    fn unit_conversion() {
        assert!(eval_plain("5km to mi").unwrap().contains("mi"));
        assert!(eval_plain("1.5 GiB to MB").unwrap().contains("MB"));
        assert!(eval_plain("100 F to C").is_some());
    }

    #[test]
    fn number_bases() {
        assert_eq!(eval_plain("0xff to decimal").as_deref(), Some("255"));
        assert_eq!(eval_plain("255 to hex").as_deref(), Some("ff"));
    }

    #[test]
    fn junk_filtered() {
        // bare units ("km") are stopped by the provider gate before reaching here
        assert_eq!(eval_plain("firefox"), None); // unknown identifier
        assert_eq!(eval_plain(""), None);
    }

    #[test]
    fn interrupt_fires() {
        let started = Instant::now();
        let _ = eval_plain("10^10^10^10");
        assert!(started.elapsed() < Duration::from_millis(500));
    }

    #[test]
    fn currency_with_fixture_rates() {
        let rates = Arc::new(RatesCache::with_rates(
            [("USD".to_string(), 1.0), ("EUR".to_string(), 0.5)].into(),
            0,
        ));
        let out = eval("100 USD to EUR", &rates, true).unwrap();
        assert!(out.contains("50"), "got: {out}");
        // disabled currency -> no result rather than stale math
        assert_eq!(eval("100 USD to EUR", &rates, false), None);
    }
}
