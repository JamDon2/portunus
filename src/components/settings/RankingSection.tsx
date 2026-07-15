import { Config } from "../../types";
import Toggle from "./Toggle";
import Select from "./Select";
import SectionHeader from "./SectionHeader";
import SettingsGroup from "./SettingsGroup";
import SettingsField from "./SettingsField";
import Slider from "./Slider";
import CategoryList from "./ranking/CategoryList";
import PinsList from "./ranking/PinsList";
import RankingPlayground from "./ranking/RankingPlayground";
import { mergedOrder, RANKING_DEFAULTS } from "./ranking/categories";

interface Props {
  config: Config;
  onChange: (c: Config) => void;
}

const STRICTNESS_OPTIONS = [
  { label: "Loose",    value: 0.03 },
  { label: "Balanced", value: 0.06 },
  { label: "Strict",   value: 0.12 },
] as const;

function strictnessLabel(v: number): string {
  return STRICTNESS_OPTIONS.find(o => Math.abs(o.value - v) < 0.001)?.label ?? `Custom (${v.toFixed(2)})`;
}

function boostLabel(v: number): string {
  if (v === 0) return "Off";
  if (v <= 10) return "Subtle";
  if (v <= 40) return "Strong";
  return "Dominant";
}

function balanceLabel(v: number): string {
  if (v === 0) return "Match only";
  if (v === 100) return "History only";
  if (v === 50) return "Balanced";
  return v < 50 ? `Match +${50 - v}` : `History +${v - 50}`;
}

function ResetButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="settings-group-reset" onClick={onClick}>
      Reset
    </button>
  );
}

export default function RankingSection({ config, onChange }: Props) {
  const setSearch = (patch: Partial<Config["search"]>) =>
    onChange({ ...config, search: { ...config.search, ...patch } });
  const setFrecency = (patch: Partial<Config["frecency"]>) =>
    onChange({ ...config, frecency: { ...config.frecency, ...patch } });
  const setRanking = (patch: Partial<Config["ranking"]>) =>
    onChange({ ...config, ranking: { ...config.ranking, ...patch } });

  const fr = config.frecency;
  const rk = config.ranking;

  const orderDirty =
    mergedOrder(rk.category_order).join() !== RANKING_DEFAULTS.category_order.join() ||
    Object.values(rk.category_weights).some(w => w !== 50) ||
    Object.values(rk.extension_weights).some(w => w !== 50);
  const boostsDirty =
    rk.match_boost.exact !== RANKING_DEFAULTS.match_boost.exact ||
    rk.match_boost.prefix !== RANKING_DEFAULTS.match_boost.prefix ||
    rk.match_boost.word_start !== RANKING_DEFAULTS.match_boost.word_start ||
    Math.abs(config.search.min_quality - 0.06) > 0.001;
  const historyDirty = !fr.enabled || fr.half_life_days !== 14 || rk.match_vs_history !== 50;

  return (
    <div className="settings-section settings-section--ranking">
      <SectionHeader
        title="Ranking"
        desc="Control what wins: category priority, match quality, history, and pinned results. Test changes live below."
      />

      <SettingsGroup
        title="Category priority"
        desc="Drag to reorder. Higher categories win; match-quality boosts below can still jump a well-matched result upward."
        action={orderDirty ? (
          <ResetButton onClick={() => setRanking({
            category_order: [...RANKING_DEFAULTS.category_order],
            category_weights: {},
            extension_weights: {},
          })} />
        ) : undefined}
      >
        <CategoryList config={config} setRanking={setRanking} />
      </SettingsGroup>

      <SettingsGroup
        title="Match quality"
        desc="How strongly a result's title matching what you typed lifts it above other categories."
        action={boostsDirty ? (
          <ResetButton onClick={() => {
            setSearch({ min_quality: 0.06 });
            setRanking({ match_boost: { ...RANKING_DEFAULTS.match_boost } });
          }} />
        ) : undefined}
      >
        <SettingsField
          name="Match strictness"
          desc="How closely the query must match. Loose shows more results; Strict filters aggressively."
        >
          <Select
            options={STRICTNESS_OPTIONS.map(o => ({ label: o.label }))}
            value={strictnessLabel(config.search.min_quality)}
            onChange={label => {
              const opt = STRICTNESS_OPTIONS.find(o => o.label === label);
              if (opt) setSearch({ min_quality: opt.value });
            }}
          />
        </SettingsField>

        <SettingsField
          name="Exact title match"
          desc="The title equals the query. At Dominant, an exact match beats every category."
        >
          <Slider
            label="Exact match boost"
            value={rk.match_boost.exact}
            min={0} max={100} step={5}
            format={boostLabel}
            onChange={v => setRanking({ match_boost: { ...rk.match_boost, exact: v } })}
          />
        </SettingsField>

        <SettingsField
          name="Title starts with query"
          desc="Typing the beginning of a name lifts it across nearby categories."
        >
          <Slider
            label="Prefix match boost"
            value={rk.match_boost.prefix}
            min={0} max={100} step={5}
            format={boostLabel}
            onChange={v => setRanking({ match_boost: { ...rk.match_boost, prefix: v } })}
          />
        </SettingsField>

        <SettingsField
          name="Word starts with query"
          desc="A word inside the title starts with the query — a tiebreaker between neighbors."
        >
          <Slider
            label="Word-start match boost"
            value={rk.match_boost.word_start}
            min={0} max={100} step={2}
            format={boostLabel}
            onChange={v => setRanking({ match_boost: { ...rk.match_boost, word_start: v } })}
          />
        </SettingsField>
      </SettingsGroup>

      <SettingsGroup
        title="Launch history"
        desc="Tracks how often you launch items so they surface faster over time."
        action={historyDirty ? (
          <ResetButton onClick={() => {
            setFrecency({ enabled: true, half_life_days: 14 });
            setRanking({ match_vs_history: 50 });
          }} />
        ) : undefined}
      >
        <SettingsField
          name="Track launch history"
          desc="Remember frequently used apps and files and promote them in results."
        >
          <Toggle label="Track launch history" checked={fr.enabled} onChange={v => setFrecency({ enabled: v })} />
        </SettingsField>

        <SettingsField
          name="Match vs history"
          desc="What matters more: how well a result matches right now, or how often you've launched it before."
        >
          <Slider
            label="Match vs history balance"
            value={rk.match_vs_history}
            min={0} max={100} step={5}
            format={balanceLabel}
            onChange={v => setRanking({ match_vs_history: v })}
          />
        </SettingsField>

        <SettingsField
          name="Half-life"
          desc="History score halves after this many days of non-use. Shorter fades faster; longer remembers longer."
        >
          <Slider
            label="Half-life (days)"
            value={fr.half_life_days}
            min={1} max={365} step={1}
            format={v => `${Math.round(v)} d`}
            onChange={v => setFrecency({ half_life_days: v })}
          />
        </SettingsField>
      </SettingsGroup>

      <SettingsGroup
        title="Pinned results"
        desc="Pinned results always rank first while you type toward their query."
      >
        <PinsList />
      </SettingsGroup>

      <RankingPlayground config={config} />
    </div>
  );
}
