import { registerProvider, type PreviewProps } from './registry';

// Command entries (kind "command") - searchable rows like "Define Word" or
// "Clipboard History" that enter a mode (or run) on Enter. Launch is handled
// directly in App (runCommand); this plugin only supplies the preview.

function CommandPreview({ result }: PreviewProps) {
  const cmd = result.command;
  return (
    <div className="clipboard-preview">
      <div className="clipboard-preview-empty">
        {cmd?.mode_kind === "scope" ? "Press ↵ to open" : "Press ↵ to run"}
      </div>
    </div>
  );
}

registerProvider({
  kinds: ['command'],
  Preview: CommandPreview,
});
