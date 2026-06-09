import { registerProvider, type PreviewProps } from './registry';

// The clipboard provider now surfaces a single command row that opens the
// dedicated clipboard-history browser (ClipboardMode). Entry browsing, preview,
// paste and delete all live in that mode, not inline in the launcher.

function ClipboardModePreview(_: PreviewProps) {
  return (
    <div className="clipboard-preview">
      <div className="clipboard-preview-empty">Press ↵ to open clipboard history</div>
    </div>
  );
}

registerProvider({
  kinds: ['clipboard-mode'],
  Preview: ClipboardModePreview,

  handleLaunch: (result, ctx) => {
    if (result.kind === 'clipboard-mode') {
      ctx.enterClipboardMode();
      return true;
    }
    return false;
  },
});
