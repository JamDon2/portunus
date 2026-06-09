import { useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { SearchResult } from "../types";
import { EnterIcon } from "../icons";
import { cleanExec } from "../utils";

interface Props {
  result: SearchResult;
  onLaunch: () => void;
}

export default function AppPreview({ result, onLaunch }: Props) {
  const [iconFailed, setIconFailed] = useState(false);

  return (
    <div className="app-preview">
      <div className="app-preview-hero">
        <div className="app-preview-icon-stage">
          {result.icon_path && !iconFailed ? (
            <img
              className="app-preview-icon"
              src={convertFileSrc(result.icon_path)}
              alt=""
              onError={() => setIconFailed(true)}
            />
          ) : (
            <div className="app-preview-icon-fallback">{result.title[0]}</div>
          )}
        </div>
        <div className="app-preview-text">
          <div className="app-preview-name">{result.title}</div>
          <div className="app-preview-sub">{result.subtitle}</div>
        </div>
      </div>
      <div className="app-preview-exec-row">
        {result.exec && <span className="app-preview-exec">{cleanExec(result.exec)}</span>}
      </div>
      <div className="app-preview-actions">
        <button className="btn-primary" onClick={onLaunch} tabIndex={-1}>
          Launch <span className="btn-kbd"><EnterIcon /></span>
        </button>
      </div>
    </div>
  );
}
