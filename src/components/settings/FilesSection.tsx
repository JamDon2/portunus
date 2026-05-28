import { Config, DirEntry } from "../../types";

interface Props {
  config: Config;
  onChange: (c: Config) => void;
}

export default function FilesSection({ config, onChange }: Props) {
  const setDirs = (dirs: DirEntry[]) =>
    onChange({ ...config, files: { ...config.files, dirs } });

  const updateDir = (i: number, patch: Partial<DirEntry>) => {
    const next = config.files.dirs.map((d, idx) => idx === i ? { ...d, ...patch } : d);
    setDirs(next);
  };

  const removeDir = (i: number) =>
    setDirs(config.files.dirs.filter((_, idx) => idx !== i));

  const addDir = () =>
    setDirs([...config.files.dirs, { path: "~/", depth: 2 }]);

  return (
    <div>
      <div className="settings-section-header">
        <div className="settings-section-name">Files</div>
        <div className="settings-section-desc">Directories indexed by the file provider.</div>
      </div>

      <div className="settings-section-note">
        Each directory is crawled up to the specified depth. Use <code>~/</code> for paths relative to your home directory.
      </div>

      <div className="settings-dir-list">
        {config.files.dirs.map((dir, i) => (
          <div className="settings-dir-row" key={i}>
            <input
              className="settings-dir-path"
              value={dir.path}
              placeholder="~/path/to/dir"
              onChange={e => updateDir(i, { path: e.target.value })}
            />
            <div className="settings-dir-depth">
              <button className="settings-dir-depth-btn" onClick={() => updateDir(i, { depth: Math.max(1, dir.depth - 1) })}>−</button>
              <span className="settings-dir-depth-val" title="Search depth">{dir.depth}</span>
              <button className="settings-dir-depth-btn" onClick={() => updateDir(i, { depth: Math.min(10, dir.depth + 1) })}>+</button>
            </div>
            <button className="settings-dir-remove" onClick={() => removeDir(i)} title="Remove">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
              </svg>
            </button>
          </div>
        ))}
        <button className="settings-dir-add" onClick={addDir}>
          <span style={{ fontSize: 14, lineHeight: 1 }}>+</span> Add directory
        </button>
      </div>
    </div>
  );
}
