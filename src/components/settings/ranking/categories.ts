import { RankingConfig } from "../../../types";

/** One draggable ranking category. Keys mirror `Category` in ranking.rs. */
export interface CategoryMeta {
  key: string;
  label: string;
  desc: string;
}

/** Default priority order - keep in sync with `DEFAULT_ORDER` in ranking.rs. */
export const RANKING_CATEGORIES: CategoryMeta[] = [
  { key: "calc", label: "Calculator", desc: "Inline math, unit and currency conversions." },
  { key: "app", label: "Apps", desc: "Installed desktop applications." },
  { key: "command", label: "Commands", desc: "Launcher commands like Define Word or Search Contents." },
  { key: "extension", label: "Extensions", desc: "Results from installed extensions." },
  { key: "file", label: "Files", desc: "Indexed files and folders." },
  { key: "dict", label: "Dictionary fill", desc: "Dictionary suggestions shown when little else matches." },
];

/** Defaults mirroring `[ranking]` in src-tauri/src/default_config.toml - keep in sync. */
export const RANKING_DEFAULTS: RankingConfig = {
  category_order: RANKING_CATEGORIES.map(c => c.key),
  match_vs_history: 50,
  category_weights: {},
  match_boost: { exact: 70, prefix: 25, word_start: 4 },
  extension_weights: {},
};

/**
 * Saved order ∩ known keys (preserving saved order), then any known keys
 * missing from the saved list appended in default order - defensive against
 * hand edits, stale keys, and future categories. Mirrors the backend merge.
 */
export function mergedOrder(saved: string[]): string[] {
  const known = new Set(RANKING_CATEGORIES.map(c => c.key));
  const out: string[] = [];
  for (const key of saved) {
    if (known.has(key) && !out.includes(key)) out.push(key);
  }
  for (const c of RANKING_CATEGORIES) {
    if (!out.includes(c.key)) out.push(c.key);
  }
  return out;
}

export function categoryMeta(key: string): CategoryMeta | undefined {
  return RANKING_CATEGORIES.find(c => c.key === key);
}

/** Human label for a 0-100 weight - no raw numbers in the default UI. */
export function weightLabel(w: number): string {
  if (w === 0) return "Hidden";
  if (w <= 25) return "Low";
  if (w < 75) return w === 50 ? "Default" : "Custom";
  if (w < 100) return "High";
  return "Max";
}
