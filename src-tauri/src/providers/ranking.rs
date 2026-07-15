//! User-configurable ranking: category bands from `[ranking]` config, match-
//! quality tier boosts, and the match-vs-history balance. Providers emit
//! [`ScoreParts`]; the registry composes the final score here so every knob
//! applies live (no provider rebuild) and `search_explain` can show the same
//! composition it ships.

use std::collections::HashMap;

use serde::Serialize;

use crate::config::RankingConfig;
use crate::content_match::normalize;

use super::{SearchResult, FRECENCY_REFERENCE, FUZZY_MAX_BONUS, FUZZY_REFERENCE};

/// Root-search competitor categories, in default priority order. Scope-only
/// tiers (content, triggered extension results, clipboard) keep their fixed
/// constants - inside a scope there is nothing to compete against.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Category {
    Calc,
    App,
    Command,
    Extension,
    File,
    Dict,
}

pub const CATEGORY_COUNT: usize = 6;

/// Default priority order. Apps deliberately sit above commands: typing an
/// app's name must win root search; a command still tops when the user types
/// *its* name (prefix/exact tier boosts jump bands).
pub const DEFAULT_ORDER: [Category; CATEGORY_COUNT] = [
    Category::Calc,
    Category::App,
    Category::Command,
    Category::Extension,
    Category::File,
    Category::Dict,
];

/// Width of one category band. Category weight nudges at most half a band so
/// the drag order stays dominant; tier boosts are sized in these units to
/// deliberately jump bands.
pub const BAND: f32 = 1_000_000.0;
/// Max offset a category/extension weight (0-100, 50 neutral) applies.
pub const WEIGHT_SPAN: f32 = 500_000.0;
/// Score added per match-boost config point (0-100 scale).
pub const BOOST_UNIT: f32 = 100_000.0;
/// Added to results matched by a pin for the typed query - above every band,
/// boost, and frecency combination, so pinned rows always surface first.
pub const PIN_SCORE: f32 = 20_000_000.0;
/// Frecency bonus ceiling at balance 100 is 2 x this; balance 50 (default)
/// reproduces the pre-ranking-config 750k max history bonus.
pub const FRECENCY_SPAN: f32 = 750_000.0;

impl Category {
    pub fn key(self) -> &'static str {
        match self {
            Category::Calc => "calc",
            Category::App => "app",
            Category::Command => "command",
            Category::Extension => "extension",
            Category::File => "file",
            Category::Dict => "dict",
        }
    }

    pub fn from_key(key: &str) -> Option<Self> {
        Some(match key {
            "calc" => Category::Calc,
            "app" => Category::App,
            "command" => Category::Command,
            "extension" => Category::Extension,
            "file" => Category::File,
            "dict" => Category::Dict,
            _ => return None,
        })
    }

    fn idx(self) -> usize {
        match self {
            Category::Calc => 0,
            Category::App => 1,
            Category::Command => 2,
            Category::Extension => 3,
            Category::File => 4,
            Category::Dict => 5,
        }
    }
}

/// How well the primary title matched the query, best tier wins. Detected on
/// the title/name field only - a description or keyword hit gets no tier boost.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MatchTier {
    Exact,
    Prefix,
    WordStart,
    Fuzzy,
}

/// Raw scoring inputs a provider attaches to a result instead of a final
/// score. `intra` carries within-band structure the provider owns: file
/// penalties and the folder offset (negative), dict fill decay, extension
/// relevance. Results without parts (scoped/content rows) keep their
/// provider-set score untouched.
#[derive(Debug, Clone)]
pub struct ScoreParts {
    pub category: Category,
    /// Extension name for `Category::Extension` rows - keys the per-extension
    /// weight.
    pub ext_name: Option<String>,
    pub tier: MatchTier,
    pub nucleo: u32,
    pub intra: f32,
}

impl ScoreParts {
    pub fn new(category: Category, tier: MatchTier, nucleo: u32) -> Self {
        Self { category, ext_name: None, tier, nucleo, intra: 0.0 }
    }
}

/// Per-result score composition, filled only by `search_explain` for the
/// Settings ranking playground.
#[derive(Debug, Clone, Serialize)]
pub struct ScoreBreakdown {
    pub base: f32,
    pub match_bonus: f32,
    pub frecency_bonus: f32,
    pub pin_bonus: f32,
    /// Positive magnitude; already subtracted from `score`.
    pub penalty: f32,
}

/// `[ranking]` config resolved into ready-to-add score numbers. Rebuilt on
/// every config change (cheap) and read at search time behind the registry's
/// RwLock, so edits apply on the next keystroke.
#[derive(Debug, Clone)]
pub struct RankingWeights {
    bands: [f32; CATEGORY_COUNT],
    hidden: [bool; CATEGORY_COUNT],
    exact: f32,
    prefix: f32,
    word_start: f32,
    /// Max nucleo-quality bonus (balance-scaled).
    pub fuzzy_max: f32,
    /// Max frecency bonus (balance-scaled; 0 when frecency is disabled).
    pub frecency_max: f32,
    ext_offsets: HashMap<String, f32>,
    ext_hidden: std::collections::HashSet<String>,
}

impl Default for RankingWeights {
    fn default() -> Self {
        Self::from_config(&RankingConfig::default(), true)
    }
}

fn weight_offset(w: u8) -> f32 {
    (w.min(100) as f32 - 50.0) / 50.0 * WEIGHT_SPAN
}

impl RankingWeights {
    pub fn from_config(cfg: &RankingConfig, frecency_enabled: bool) -> Self {
        // Known keys from the saved order (first occurrence wins), then any
        // missing categories appended in default order - tolerant of hand
        // edits, stale keys, and future categories.
        let mut order: Vec<Category> = Vec::with_capacity(CATEGORY_COUNT);
        for key in &cfg.category_order {
            if let Some(c) = Category::from_key(key) {
                if !order.contains(&c) {
                    order.push(c);
                }
            }
        }
        for c in DEFAULT_ORDER {
            if !order.contains(&c) {
                order.push(c);
            }
        }

        let mut bands = [0.0; CATEGORY_COUNT];
        let mut hidden = [false; CATEGORY_COUNT];
        for (pos, c) in order.iter().enumerate() {
            let w = cfg.category_weights.get(c.key()).copied().unwrap_or(50);
            bands[c.idx()] = (CATEGORY_COUNT - pos) as f32 * BAND + weight_offset(w);
            hidden[c.idx()] = w == 0;
        }

        let balance = cfg.match_vs_history.min(100) as f32;
        let mut ext_offsets = HashMap::new();
        let mut ext_hidden = std::collections::HashSet::new();
        for (name, &w) in &cfg.extension_weights {
            if w == 0 {
                ext_hidden.insert(name.clone());
            } else if w != 50 {
                ext_offsets.insert(name.clone(), weight_offset(w));
            }
        }

        Self {
            bands,
            hidden,
            exact: cfg.match_boost.exact.min(100) as f32 * BOOST_UNIT,
            prefix: cfg.match_boost.prefix.min(100) as f32 * BOOST_UNIT,
            word_start: cfg.match_boost.word_start.min(100) as f32 * BOOST_UNIT,
            fuzzy_max: (100.0 - balance) / 50.0 * FUZZY_MAX_BONUS,
            frecency_max: if frecency_enabled { balance / 50.0 * FRECENCY_SPAN } else { 0.0 },
            ext_offsets,
            ext_hidden,
        }
    }

    fn is_hidden(&self, parts: &ScoreParts) -> bool {
        if self.hidden[parts.category.idx()] {
            return true;
        }
        matches!(&parts.ext_name, Some(name) if self.ext_hidden.contains(name))
    }

    fn band(&self, parts: &ScoreParts) -> f32 {
        let mut base = self.bands[parts.category.idx()];
        if let Some(name) = &parts.ext_name {
            base += self.ext_offsets.get(name).copied().unwrap_or(0.0);
        }
        base
    }

    fn tier_bonus(&self, tier: MatchTier) -> f32 {
        match tier {
            MatchTier::Exact => self.exact,
            MatchTier::Prefix => self.prefix,
            MatchTier::WordStart => self.word_start,
            MatchTier::Fuzzy => 0.0,
        }
    }

    /// Nucleo-quality bonus on the balance-scaled scale.
    pub fn fuzzy_bonus(&self, nucleo: u32) -> f32 {
        (nucleo as f32 / FUZZY_REFERENCE).min(1.0) * self.fuzzy_max
    }

    /// Frecency bonus for a raw (decayed) frecency score.
    pub fn frecency_bonus(&self, frecency_score: f32) -> f32 {
        (frecency_score / FRECENCY_REFERENCE).min(1.0) * self.frecency_max
    }
}

/// Detects the match tier of `query` against a result's primary title.
/// Both sides go through the content-index normalization (casefold +
/// diacritic fold) so "cafe" exact-matches "Café".
pub fn detect_tier(title: &str, query: &str) -> MatchTier {
    let nq = normalize(query.trim());
    if nq.is_empty() {
        return MatchTier::Fuzzy;
    }
    let nt = normalize(title);
    if nt == nq {
        return MatchTier::Exact;
    }
    if nt.starts_with(&nq) {
        return MatchTier::Prefix;
    }
    let mut word_start = true;
    for (i, c) in nt.char_indices() {
        if word_start && nt[i..].starts_with(&nq) {
            return MatchTier::WordStart;
        }
        word_start = !c.is_alphanumeric();
    }
    MatchTier::Fuzzy
}

/// Composes final scores for parts-bearing results and drops hidden
/// categories/extensions (root search only - scoped paths pass
/// `drop_hidden = false`). Results without parts keep their provider score.
/// With `explain`, fills the per-result breakdown for the playground.
pub fn apply_ranking(
    results: &mut Vec<SearchResult>,
    weights: &RankingWeights,
    drop_hidden: bool,
    explain: bool,
) {
    if drop_hidden {
        results.retain(|r| r.parts.as_ref().is_none_or(|p| !weights.is_hidden(p)));
    }
    for r in results.iter_mut() {
        let Some(parts) = &r.parts else { continue };
        let band = weights.band(parts);
        let tier = weights.tier_bonus(parts.tier);
        let fuzzy = weights.fuzzy_bonus(parts.nucleo);
        r.score = band + tier + fuzzy + parts.intra;
        if explain {
            r.breakdown = Some(ScoreBreakdown {
                base: band + parts.intra.max(0.0),
                match_bonus: tier + fuzzy,
                frecency_bonus: 0.0,
                pin_bonus: 0.0,
                penalty: (-parts.intra).max(0.0),
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::{apply_frecency_weights, SearchResult};

    fn result(title: &str, parts: ScoreParts) -> SearchResult {
        SearchResult {
            id: format!("test:{title}"),
            title: title.to_string(),
            parts: Some(parts),
            ..Default::default()
        }
    }

    fn ranked(mut results: Vec<SearchResult>, weights: &RankingWeights) -> Vec<String> {
        apply_ranking(&mut results, weights, true, false);
        results.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap());
        results.into_iter().map(|r| r.title).collect()
    }

    #[test]
    fn tier_detection() {
        assert_eq!(detect_tier("Zed", "zed"), MatchTier::Exact);
        assert_eq!(detect_tier("Café", "cafe"), MatchTier::Exact);
        assert_eq!(detect_tier("Search Code", "search co"), MatchTier::Prefix);
        assert_eq!(detect_tier("Visual Studio Code", "code"), MatchTier::WordStart);
        assert_eq!(detect_tier("Search Code", "code"), MatchTier::WordStart);
        assert_eq!(detect_tier("naïve-notes.txt", "notes"), MatchTier::WordStart);
        assert_eq!(detect_tier("Visual Studio Code", "vsc"), MatchTier::Fuzzy);
        assert_eq!(detect_tier("Files", ""), MatchTier::Fuzzy);
    }

    /// The screenshot regression: query "code" must rank the app above the
    /// command entry - both word-start match, the app band wins.
    #[test]
    fn app_beats_command_on_shared_word_start() {
        let weights = RankingWeights::default();
        let order = ranked(
            vec![
                result(
                    "Search Code",
                    ScoreParts::new(Category::Command, detect_tier("Search Code", "code"), 1400),
                ),
                result(
                    "Visual Studio Code",
                    ScoreParts::new(
                        Category::App,
                        detect_tier("Visual Studio Code", "code"),
                        1300,
                    ),
                ),
            ],
            &weights,
        );
        assert_eq!(order[0], "Visual Studio Code");
    }

    /// Typing the command's own name still tops it: prefix boost jumps bands.
    #[test]
    fn command_prefix_match_jumps_above_apps() {
        let weights = RankingWeights::default();
        let order = ranked(
            vec![
                result(
                    "Search Code",
                    ScoreParts::new(
                        Category::Command,
                        detect_tier("Search Code", "search co"),
                        1500,
                    ),
                ),
                result(
                    "Visual Studio Code",
                    ScoreParts::new(
                        Category::App,
                        detect_tier("Visual Studio Code", "search co"),
                        600,
                    ),
                ),
            ],
            &weights,
        );
        assert_eq!(order[0], "Search Code");
    }

    #[test]
    fn zero_weight_hides_category_in_root_only() {
        let mut cfg = RankingConfig::default();
        cfg.category_weights.insert("file".into(), 0);
        let weights = RankingWeights::from_config(&cfg, true);

        let mk = || {
            vec![result(
                "notes.txt",
                ScoreParts::new(Category::File, MatchTier::Fuzzy, 900),
            )]
        };
        let mut root = mk();
        apply_ranking(&mut root, &weights, true, false);
        assert!(root.is_empty());

        let mut scoped = mk();
        apply_ranking(&mut scoped, &weights, false, false);
        assert_eq!(scoped.len(), 1);
    }

    #[test]
    fn zero_weight_hides_single_extension() {
        let mut cfg = RankingConfig::default();
        cfg.extension_weights.insert("emoji".into(), 0);
        let weights = RankingWeights::from_config(&cfg, true);

        let mut ext = ScoreParts::new(Category::Extension, MatchTier::Fuzzy, 0);
        ext.ext_name = Some("emoji".into());
        let mut other = ScoreParts::new(Category::Extension, MatchTier::Fuzzy, 0);
        other.ext_name = Some("cheatsh".into());
        let mut results = vec![result("smile", ext), result("tar", other)];
        apply_ranking(&mut results, &weights, true, false);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].title, "tar");
    }

    #[test]
    fn category_weight_nudges_within_half_band() {
        // Files weight 100 (+500k) must not overtake the extension band above
        // (1M gap), but must overtake a same-band rival's full fuzzy bonus.
        let mut cfg = RankingConfig::default();
        cfg.category_weights.insert("file".into(), 100);
        let weights = RankingWeights::from_config(&cfg, true);
        let order = ranked(
            vec![
                result("ext row", {
                    let mut p = ScoreParts::new(Category::Extension, MatchTier::Fuzzy, 0);
                    p.ext_name = Some("emoji".into());
                    p
                }),
                result("boosted file", ScoreParts::new(Category::File, MatchTier::Fuzzy, 0)),
            ],
            &weights,
        );
        assert_eq!(order[0], "ext row");
    }

    #[test]
    fn custom_order_reorders_bands() {
        let cfg = RankingConfig {
            category_order: vec!["file".into(), "app".into()],
            ..Default::default()
        };
        let weights = RankingWeights::from_config(&cfg, true);
        let order = ranked(
            vec![
                result("App", ScoreParts::new(Category::App, MatchTier::Fuzzy, 1500)),
                result("file.txt", ScoreParts::new(Category::File, MatchTier::Fuzzy, 1500)),
            ],
            &weights,
        );
        // Saved order lists file first; missing categories append after.
        assert_eq!(order[0], "file.txt");
    }

    #[test]
    fn stale_order_keys_are_ignored() {
        let cfg = RankingConfig {
            category_order: vec!["bogus".into(), "app".into(), "app".into()],
            ..Default::default()
        };
        let weights = RankingWeights::from_config(&cfg, true);
        // App leads the merged order; everything else follows the default.
        assert!(weights.bands[Category::App.idx()] > weights.bands[Category::Calc.idx()]);
    }

    #[test]
    fn balance_extremes_scale_fuzzy_and_frecency() {
        let mut cfg = RankingConfig::default();
        cfg.match_vs_history = 0;
        let match_only = RankingWeights::from_config(&cfg, true);
        assert_eq!(match_only.fuzzy_bonus(1500), 2.0 * FUZZY_MAX_BONUS);
        assert_eq!(match_only.frecency_bonus(1000.0), 0.0);

        cfg.match_vs_history = 100;
        let history_only = RankingWeights::from_config(&cfg, true);
        assert_eq!(history_only.fuzzy_bonus(1500), 0.0);
        assert_eq!(history_only.frecency_bonus(1000.0), 2.0 * FRECENCY_SPAN);

        cfg.match_vs_history = 50;
        let balanced = RankingWeights::from_config(&cfg, false);
        assert_eq!(balanced.frecency_max, 0.0, "disabled frecency zeroes the bonus");
    }

    /// Default weights preserve the legacy relative order for fuzzy-only
    /// results: calc > app > command > extension > file > dict-fill, folders
    /// below files, penalties inside the file band.
    #[test]
    fn default_order_bands_are_monotonic() {
        let weights = RankingWeights::default();
        let mut folder = ScoreParts::new(Category::File, MatchTier::Fuzzy, 0);
        folder.intra = -700_000.0;
        let order = ranked(
            vec![
                result("fill", {
                    let mut p = ScoreParts::new(Category::Dict, MatchTier::Fuzzy, 0);
                    p.intra = -0.001;
                    p
                }),
                result("folder", folder),
                result("file", ScoreParts::new(Category::File, MatchTier::Fuzzy, 0)),
                result("ext", {
                    let mut p = ScoreParts::new(Category::Extension, MatchTier::Fuzzy, 0);
                    p.ext_name = Some("emoji".into());
                    p
                }),
                result("cmd", ScoreParts::new(Category::Command, MatchTier::Fuzzy, 0)),
                result("app", ScoreParts::new(Category::App, MatchTier::Fuzzy, 0)),
                result("calc", ScoreParts::new(Category::Calc, MatchTier::Fuzzy, 0)),
            ],
            &weights,
        );
        assert_eq!(order, vec!["calc", "app", "cmd", "ext", "file", "folder", "fill"]);
    }

    /// Exact tier must beat the strongest non-pinned rival: top band +
    /// word-start + full fuzzy + max frecency.
    #[test]
    fn exact_match_outranks_maxed_rival() {
        let weights = RankingWeights::default();
        let mut rival = result(
            "Search Code",
            ScoreParts::new(Category::Calc, MatchTier::WordStart, 1500),
        );
        let mut exact = result("Zed", ScoreParts::new(Category::File, MatchTier::Exact, 1500));
        let mut results = vec![std::mem::take(&mut rival), std::mem::take(&mut exact)];
        apply_ranking(&mut results, &weights, true, false);
        results[0].score += weights.frecency_max; // rival gets max history
        assert!(results[1].score > results[0].score);
    }

    #[test]
    fn explain_fills_breakdown() {
        let weights = RankingWeights::default();
        let mut p = ScoreParts::new(Category::File, MatchTier::Prefix, 750);
        p.intra = -200_000.0;
        let mut results = vec![result("code.py", p)];
        apply_ranking(&mut results, &weights, true, true);
        let b = results[0].breakdown.as_ref().unwrap();
        assert_eq!(b.penalty, 200_000.0);
        assert!(b.match_bonus > 0.0);
        assert!((b.base + b.match_bonus - b.penalty - results[0].score).abs() < 1.0);
    }

    #[test]
    fn pin_tops_everything_and_marks_result() {
        let weights = RankingWeights::default();
        let mut results = vec![
            result("calc", ScoreParts::new(Category::Calc, MatchTier::Exact, 1500)),
            result("notes.txt", ScoreParts::new(Category::File, MatchTier::Fuzzy, 100)),
        ];
        apply_ranking(&mut results, &weights, true, false);
        let pinned: std::collections::HashSet<String> =
            std::iter::once("test:notes.txt".to_string()).collect();
        crate::providers::apply_pins(&mut results, &pinned, false);
        results.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap());
        assert_eq!(results[0].title, "notes.txt");
        assert!(results[0].pinned);
        assert!(!results[1].pinned);
    }

    #[test]
    fn frecency_helper_uses_weights_scale() {
        let weights = RankingWeights::default();
        let mut results = vec![{
            let mut r = result("app", ScoreParts::new(Category::App, MatchTier::Fuzzy, 0));
            r.id = "app:test".into();
            r
        }];
        apply_ranking(&mut results, &weights, true, false);
        let before = results[0].score;
        let mut scores = std::collections::HashMap::new();
        scores.insert("app:test".to_string(), 40.0_f32);
        apply_frecency_weights(&mut results, &scores, &weights, false);
        assert!((results[0].score - before - weights.frecency_max).abs() < 1.0);
    }
}
