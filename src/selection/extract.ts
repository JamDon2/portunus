// Selection text extraction. Range.toString() concatenates raw text node data,
// which runs markdown paragraphs and table cells together - this walker emits
// "\n" when crossing block boundaries and "\t" between table cells instead.

import { textNodesInRange, rangeOffsetsInNode } from "./geometry";

const BLOCK_DISPLAYS = new Set([
  "block",
  "flex",
  "grid",
  "list-item",
  "table",
  "table-row",
  "table-caption",
  "flow-root",
]);

function isBlockElement(el: Element): boolean {
  // Geometry-layer word spans are absolutely positioned (blockified display),
  // but flow as inline text - the attribute opts them out of line breaking.
  if (el.hasAttribute("data-sel-inline")) return false;
  return BLOCK_DISPLAYS.has(getComputedStyle(el).display);
}

function isCellElement(el: Element): boolean {
  return getComputedStyle(el).display === "table-cell";
}

/** The chain of ancestors from a node up to (excluding) `stop`. */
function ancestors(node: Node, stop: Node): Element[] {
  const out: Element[] = [];
  for (let el = node.parentElement; el && el !== stop; el = el.parentElement) out.push(el);
  return out;
}

/** Separator owed between two consecutive text nodes of a range: "\n" when a
 *  block boundary is crossed, "\t" between sibling table cells, else "". */
function boundarySeparator(prev: Text, next: Text, common: Node): string {
  // Walk up from each side to the shared ancestor; any block element left or
  // entered means a visual line break. <br> between them also breaks.
  const prevChain = ancestors(prev, common);
  const nextChain = ancestors(next, common);
  const shared = new Set(nextChain);
  let cellBoundary = false;
  for (const el of prevChain) {
    if (shared.has(el)) break;
    if (isCellElement(el)) cellBoundary = true;
    if (isBlockElement(el)) return "\n";
  }
  for (const el of nextChain) {
    if (prevChain.includes(el)) break;
    if (isCellElement(el)) cellBoundary = true;
    if (isBlockElement(el)) return "\n";
  }
  if (cellBoundary) return "\t";
  // Same block: an intervening <br> still breaks the line.
  const r = document.createRange();
  r.setStartAfter(prev);
  r.setEndBefore(next);
  const frag = r.cloneContents();
  return frag.querySelector("br") ? "\n" : "";
}

/** Whether two consecutive text nodes sit on different visual lines (block
 *  boundary, <br>, or a table-cell edge). Used by triple-click line select. */
export function separatesLine(prev: Text, next: Text, common: Node): boolean {
  return boundarySeparator(prev, next, common) !== "";
}

/** Plain text of a range with block-aware newlines and cell tabs. */
export function extractText(range: Range): string {
  const nodes = textNodesInRange(range);
  if (nodes.length === 0) return "";
  const common = range.commonAncestorContainer;
  let out = "";
  let prev: Text | null = null;
  for (const node of nodes) {
    const [start, end] = rangeOffsetsInNode(range, node);
    if (start >= end) continue;
    if (prev) out += boundarySeparator(prev, node, common);
    out += node.data.slice(start, end);
    prev = node;
  }
  return out;
}
