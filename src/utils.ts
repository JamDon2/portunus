export function shortenPath(path: string): string {
  return path.replace(/^\/home\/[^/]+/, "~").replace(/^\/root/, "~");
}

export function groupLabel(kind: string): string | null {
  if (kind === "app") return "APPS";
  if (kind === "file" || kind === "folder") return "FILES";
  if (kind === "timer-item" || kind === "timer-create" || kind === "timer-new" || kind === "timer-expired") return "TIMERS";
  return null;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

export function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric",
  });
}

export function fmtRemaining(secs: number): string {
  if (secs <= 0) return "Done";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function fileKind(title: string, isFolder: boolean): string {
  if (isFolder) return "Folder";
  const ext = title.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    pdf: "PDF Document",
    png: "PNG Image", jpg: "JPEG Image", jpeg: "JPEG Image",
    gif: "GIF Image", webp: "WebP Image", svg: "SVG Image",
    ts: "TypeScript Source", tsx: "TypeScript Source",
    js: "JavaScript Source", jsx: "JavaScript Source",
    rs: "Rust Source", py: "Python Source", go: "Go Source",
    md: "Markdown", txt: "Text File",
    zip: "Archive", tar: "Archive", gz: "Archive",
    bz2: "Archive", xz: "Archive", "7z": "Archive", rar: "Archive",
    mp4: "Video", mkv: "Video", mov: "Video", avi: "Video",
    mp3: "Audio", flac: "Audio", wav: "Audio", ogg: "Audio",
    json: "JSON Data", xml: "XML Document",
    html: "HTML Document", css: "CSS Stylesheet",
    sh: "Shell Script", toml: "TOML Config",
    yaml: "YAML Config", yml: "YAML Config",
  };
  return map[ext] ?? "File";
}
