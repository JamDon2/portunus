import { useLayoutEffect, useRef } from "react";
import { highlightInElement, focusBestCluster } from "../highlight";

/**
 * Marks search terms inside the returned ref's subtree and scrolls the densest
 * section (most distinct terms) into view. The caller must remount the
 * highlighted subtree (via a `key`) whenever content or terms change, so the
 * effect always runs on clean, React-untouched DOM.
 *
 * Keying is async (one backend round-trip), so marks + scroll land just after
 * the first paint; the remount guarantees a late-resolving highlight only ever
 * mutates the current DOM.
 */
export function useTermHighlight<T extends HTMLElement>(terms: string[], dep: unknown) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !terms.length) return;
    let cancelled = false;
    highlightInElement(el, terms, () => cancelled).then(() => {
      if (cancelled) return;
      focusBestCluster(el)?.scrollIntoView({ block: "center" });
    });
    return () => {
      cancelled = true;
    };
  }, [dep, terms]);
  return ref;
}
