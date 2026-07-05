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

pub fn eval(query: &str, rates: &Arc<RatesCache>, currency_enabled: bool) -> Option<String> {
    // Context::new() is cheap (empty maps); fend's unit tables are static.
    let mut ctx = fend_core::Context::new();
    if currency_enabled {
        ctx.set_exchange_rate_handler_v2(RatesHandler(Arc::clone(rates)));
    }
    let interrupt = Deadline(Instant::now() + EVAL_DEADLINE);
    let result = fend_core::evaluate_with_interrupt(query, &mut ctx, &interrupt).ok()?;
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
