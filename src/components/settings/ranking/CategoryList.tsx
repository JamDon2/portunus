import { Config } from "../../../types";
import { useExtensionMeta } from "../../../extensions/meta";
import SortableList from "../SortableList";
import Slider from "../Slider";
import Badge from "../Badge";
import { categoryMeta, mergedOrder, weightLabel } from "./categories";

interface Props {
  config: Config;
  setRanking: (patch: Partial<Config["ranking"]>) => void;
}

const GripIcon = () => (
  <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" aria-hidden="true">
    {[1, 7].map(x => [2, 7, 12].map(y => <circle key={`${x}${y}`} cx={x + 1} cy={y} r="1.3" />))}
  </svg>
);

const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg
    width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor"
    strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    style={{ transform: open ? "rotate(90deg)" : undefined, transition: "transform 0.15s" }}
  >
    <path d="M4 2l4 4-4 4" />
  </svg>
);

/**
 * The ranking centerpiece: drag categories into priority order; expand a row
 * to fine-tune its weight (and, for Extensions, each installed extension).
 */
export default function CategoryList({ config, setRanking }: Props) {
  const ranking = config.ranking;
  const order = mergedOrder(ranking.category_order);
  const extensions = useExtensionMeta().filter(e => e.enabled);

  const weightOf = (key: string) => ranking.category_weights[key] ?? 50;
  const setWeight = (key: string, w: number) =>
    setRanking({ category_weights: { ...ranking.category_weights, [key]: w } });
  const extWeightOf = (name: string) => ranking.extension_weights[name] ?? 50;
  const setExtWeight = (name: string, w: number) =>
    setRanking({ extension_weights: { ...ranking.extension_weights, [name]: w } });

  return (
    <SortableList
      items={order}
      getKey={k => k}
      ariaLabel="Result category priority"
      onReorder={keys => setRanking({ category_order: keys })}
      renderRow={(key, ctx) => {
        const meta = categoryMeta(key)!;
        const w = weightOf(key);
        return (
          <>
            <span className="settings-sortable-grip" {...ctx.handleProps} aria-label={`Reorder ${meta.label}`}>
              <GripIcon />
            </span>
            <div className="settings-sortable-text">
              <div className="settings-sortable-label">{meta.label}</div>
              <div className="settings-sortable-desc">{meta.desc}</div>
            </div>
            {w !== 50 && (
              <Badge tone={w === 0 ? "error" : "neutral"}>{weightLabel(w)}</Badge>
            )}
            <button
              type="button"
              className="settings-sortable-chevron"
              aria-label={`${ctx.expanded ? "Collapse" : "Expand"} ${meta.label}`}
              aria-expanded={ctx.expanded}
              onClick={ctx.toggleExpand}
            >
              <ChevronIcon open={ctx.expanded} />
            </button>
          </>
        );
      }}
      renderExpanded={key => {
        const meta = categoryMeta(key)!;
        return (
          <div className="settings-sortable-detail-body">
            <div className="settings-sortable-detail-row">
              <span className="settings-sortable-detail-label">Weight</span>
              <Slider
                label={`${meta.label} weight`}
                value={weightOf(key)}
                min={0} max={100} step={5}
                format={weightLabel}
                onChange={v => setWeight(key, v)}
              />
            </div>
            {key === "extension" && extensions.length > 0 && (
              <div className="settings-sortable-detail-exts">
                {extensions.map(ext => (
                  <div className="settings-sortable-detail-row" key={ext.name}>
                    <span className="settings-sortable-detail-label">
                      {ext.name}
                      {ext.dev && <Badge tone="dev">dev</Badge>}
                    </span>
                    <Slider
                      label={`${ext.name} weight`}
                      value={extWeightOf(ext.name)}
                      min={0} max={100} step={5}
                      format={weightLabel}
                      onChange={v => setExtWeight(ext.name, v)}
                    />
                  </div>
                ))}
              </div>
            )}
            {key === "extension" && extensions.length === 0 && (
              <div className="settings-sortable-detail-empty">No extensions installed.</div>
            )}
            {weightOf(key) === 0 && (
              <div className="settings-sortable-detail-note">
                Hidden from search results. {key === "dict" ? "" : "Scoped access still works."}
              </div>
            )}
          </div>
        );
      }}
    />
  );
}
