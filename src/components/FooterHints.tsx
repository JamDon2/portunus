import { ReactNode } from "react";
import { SearchResult } from "../types";
import { EnterIcon, DeleteIcon } from "../icons";
import { isPreviewable } from "../utils";

interface Props {
  selected: SearchResult | null;
  /** The Quicklook overlay is open, so Esc closes it and Shift+Enter dismisses. */
  quicklookOpen?: boolean;
  /** In the dedicated clipboard browser; hints + paste-vs-copy wording change. */
  clipboardMode?: boolean;
  /** In the Tab-activated full-text "Contents" mode. */
  contentMode?: boolean;
  /** wtype is available, so Enter pastes into the focused window vs copy-only. */
  smartPaste?: boolean;
  /** The clipboard list is unfiltered + unsearched (idle), so show the Tab hint. */
  clipboardIdle?: boolean;
  /** Whether PDF term-highlighting is on (Ctrl+H); drives the Contents-mode hint. */
  pdfHighlight?: boolean;
  /** The extension action picker is open; it owns the keys. */
  actionPickerOpen?: boolean;
}

// Reusable hint atoms. The bar shows only the selected result's actions -
// navigation, Esc and Alt+1..9 are learned once and stay off the bar (Alt-held
// badges surface the jump shortcuts in place).
const Open = () => <span className="hint"><kbd><EnterIcon /></kbd> open</span>;
const PdfPageNav = () => <span className="hint"><kbd>ctrl</kbd><kbd>←→</kbd> page</span>;
const Peek = () => <span className="hint"><kbd>shift</kbd><kbd><EnterIcon /></kbd> peek</span>;

function hints(
  selected: SearchResult | null,
  quicklookOpen: boolean,
  clipboardMode: boolean,
  contentMode: boolean,
  smartPaste: boolean,
  clipboardIdle: boolean,
  pdfHighlight: boolean,
  actionPickerOpen: boolean,
): ReactNode {
  const k = selected?.kind;

  if (actionPickerOpen) return <>
    <span className="hint"><kbd><EnterIcon /></kbd> run</span>
    <span className="hint"><kbd>Esc</kbd> back</span>
  </>;
  const isPdf = selected?.title.toLowerCase().endsWith(".pdf") ?? false;
  const Highlight = () => (
    <span className="hint"><kbd>ctrl</kbd><kbd>H</kbd> highlight {pdfHighlight ? "off" : "on"}</span>
  );

  // Full-text "Contents" mode: reuses the file row.
  if (contentMode) {
    return <>
      <Open />
      {isPdf && <PdfPageNav />}
      {isPdf && <Highlight />}
      {selected && isPreviewable(selected) && <Peek />}
    </>;
  }

  // Dedicated clipboard browser. Enter degrades to copy-and-close without wtype,
  // so the bar must say "copy" not "paste" (and drop the redundant ctrl+enter).
  if (clipboardMode) return <>
    {smartPaste
      ? <span className="hint"><kbd><EnterIcon /></kbd> paste</span>
      : <span className="hint"><kbd><EnterIcon /></kbd> copy</span>}
    <span className="hint"><kbd>shift</kbd><kbd><DeleteIcon /></kbd> delete</span>
    {clipboardIdle && <span className="hint"><kbd>Tab</kbd> filter</span>}
  </>;

  // While Quicklook is open the keys mean something different - keep the bar honest.
  if (quicklookOpen) return <>
    <Open />
    <span className="hint"><kbd>Esc</kbd> close</span>
  </>;

  if (k === "command") return <Open />;

  if (k === "calc") return <span className="hint"><kbd>ctrl</kbd><kbd>C</kbd> copy value</span>;

  if (k === "dict-hint") return <span className="hint"><kbd>|</kbd> start typing</span>;
  if (k === "dict") return <span className="hint"><kbd>ctrl</kbd><kbd>C</kbd> copy definition</span>;

  if (k === "ext-error") return <span className="hint"><kbd><EnterIcon /></kbd> open logs</span>;
  if (k === "content-disabled") return <span className="hint"><kbd><EnterIcon /></kbd> open settings</span>;
  if (k === "content-hint") return <span className="hint"><kbd>Tab</kbd> search contents</span>;

  if (k === "file" || k === "folder") {
    return (
      <><Open />
        {k === "file" && <span className="hint"><kbd>ctrl</kbd><kbd><EnterIcon /></kbd> reveal</span>}
        {isPdf && <PdfPageNav />}
        {selected && isPreviewable(selected) && <Peek />}
      </>
    );
  }
  if (k === "app") return <span className="hint"><kbd><EnterIcon /></kbd> launch</span>;

  // Extension result: show its real default-action label, and advertise the
  // picker only when there's more than one action to pick from.
  if (selected?.ext) {
    const actions = selected.ext.actions ?? [];
    const defaultLabel = actions[0]?.label?.toLowerCase() ?? "open";
    return <>
      <span className="hint"><kbd><EnterIcon /></kbd> {defaultLabel}</span>
      {actions.length > 1 && <span className="hint"><kbd>alt</kbd><kbd><EnterIcon /></kbd> actions</span>}
    </>;
  }

  // Default: generic result row
  return <Open />;
}

export default function FooterHints({ selected, quicklookOpen = false, clipboardMode = false, contentMode = false, smartPaste = false, clipboardIdle = false, pdfHighlight = true, actionPickerOpen = false }: Props) {
  return <div className="hints">{hints(selected, quicklookOpen, clipboardMode, contentMode, smartPaste, clipboardIdle, pdfHighlight, actionPickerOpen)}</div>;
}
