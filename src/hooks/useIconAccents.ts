import { useMemo, useReducer } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { SearchResult } from "../types";
import { iconAccent } from "../iconAccent";

/**
 * Map each app result id to its dominant icon colour (the accent-bleed source).
 * Only `app` results carry a colourful bitmap worth sampling; everything else is
 * left out so the bleed stays an app-launcher flourish. Sampling is async;
 * resolving a sample bumps a tick so the map rebuilds and late colours appear.
 */
export function useIconAccents(results: SearchResult[]): Map<string, string> {
  const [tick, bump] = useReducer((n: number) => n + 1, 0);

  return useMemo(() => {
    const map = new Map<string, string>();
    for (const r of results) {
      if (r.kind !== "app") continue;
      const src = r.icon_path ? convertFileSrc(r.icon_path) : r.icon_data_uri;
      const color = src ? iconAccent(src, bump) : null;
      if (color) map.set(r.id, color);
    }
    return map;
    // `tick` advances when a pending sample resolves, forcing a rebuild.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, tick]);
}
