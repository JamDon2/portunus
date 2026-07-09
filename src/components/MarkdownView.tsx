import { memo, useEffect, useMemo, useState } from "react";
import type { MouseEvent as ReactMouseEvent, ReactElement } from "react";
import { invoke } from "@tauri-apps/api/core";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import type { PluggableList } from "unified";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import hljs from "../hljs";
import { useTermHighlight } from "../hooks/useTermHighlight";

/**
 * Shared markdown renderer for every preview - file previews (local .md /
 * office docs) and extension previews alike. One pipeline, one stylesheet
 * (`.md-preview-wrap`), so they all render identically.
 *
 * All content is treated as untrusted: rehype-raw parses the embedded HTML that
 * real-world markdown (READMEs especially) leans on, then rehype-sanitize
 * strips scripts, event handlers, and javascript: URLs via an allowlist - the
 * same model GitHub/npm use. There's no trusted fast path: a local .md can be
 * anything the user downloaded, so it gets the same treatment as an extension's.
 *
 * Links never navigate the app: the anchor handler opens them in the system
 * browser. Images resolve remote URLs directly and local paths through the
 * backend image renderer (relative to `baseDir`).
 */

// hast-util-sanitize's GitHub schema, widened to keep alignment/sizing hints
// that READMEs use heavily (they're inert presentational attributes).
const SANITIZE_SCHEMA = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    "*": [...(defaultSchema.attributes?.["*"] ?? []), "align"],
    img: [...(defaultSchema.attributes?.img ?? []), "width", "height", "align"],
  },
};

const REHYPE: PluggableList = [rehypeRaw, [rehypeSanitize, SANITIZE_SCHEMA]];
const REMARK: PluggableList = [remarkGfm];

// Rendered-tree cache keyed source\0baseDir. The per-instance useMemo below only
// spares re-parsing while a preview stays mounted; arrowing/typing flips the
// selected file, remounting the preview and losing that memo, so revisiting a
// README (common while typing "readme.md") would re-run the whole
// remark/rehype/hljs pipeline (~12ms cold, far more in dev) and peg the main
// thread. This module-level cache survives remounts - a revisited document
// paints from the cached element instead. Capped like the pdf/img/text caches;
// eviction is insertion-order (approximate LRU).
const treeCache = new Map<string, ReactElement>();
const TREE_CACHE_CAP = 32;
function treeCacheKey(source: string, baseDir: string): string {
  return `${source}\0${baseDir}`;
}

const mdCodeComponent: Components["code"] = ({ className, children }) => {
  const match = /language-(\w+)/.exec(className ?? "");
  if (match) {
    try {
      const highlighted = hljs.highlight(String(children).replace(/\n$/, ""), {
        language: match[1],
        ignoreIllegals: true,
      });
      return (
        <code
          className={`hljs language-${match[1]}`}
          dangerouslySetInnerHTML={{ __html: highlighted.value }}
        />
      );
    } catch { /* fall through to plain */ }
  }
  return <code className={className}>{children}</code>;
};

// Resolve a markdown image src against the document's directory and load it via
// render_image_preview (the asset protocol is scoped to icon dirs, so local
// paths can't be used directly). Remote (http/https/data) srcs pass through
// unchanged - extension previews rely on this for README images.
function MarkdownImage({ src, alt, baseDir }: { src?: string; alt?: string; baseDir: string }) {
  const isRemote = !!src && /^(https?:|data:)/.test(src);
  const [resolved, setResolved] = useState<string | null>(isRemote ? src! : null);

  useEffect(() => {
    if (!src || isRemote) { setResolved(src ?? null); return; }
    // A relative/local path with no base can't be resolved (e.g. extension
    // content) - render nothing rather than probing a bogus path.
    if (!baseDir) { setResolved(null); return; }
    let cancelled = false;
    let objectUrl: string | null = null;
    setResolved(null);
    const abs = src.startsWith("/") ? src : `${baseDir}/${src}`;
    invoke<ArrayBuffer>("render_image_preview", { path: abs })
      .then(buf => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(new Blob([buf], { type: "image/jpeg" }));
        setResolved(objectUrl);
      })
      .catch(() => { if (!cancelled) setResolved(null); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [src, baseDir, isRemote]);

  if (!resolved) return null;
  return <img src={resolved} alt={alt ?? ""} />;
}

// Intercept markdown link clicks. A bare <a href> would navigate the launcher
// webview itself to the target, destroying the React app (transparent dead
// window, keybinds gone). Route through the backend launch_app command (same
// xdg-open path used to open results), which also hides the launcher.
function makeMdAnchor(baseDir: string): Components["a"] {
  return ({ href, children }) => {
    const onClick = (e: ReactMouseEvent) => {
      e.preventDefault();
      if (!href || href.startsWith("#")) return;
      const target = /^[a-z][a-z0-9+.-]*:/i.test(href) // already a URL/URI scheme
        ? href
        : href.startsWith("/") ? href
        : baseDir ? `${baseDir}/${href}` : href;
      invoke("launch_app", { exec: `xdg-open "${target}"` }).catch(err => console.error("[preview] open link failed:", err));
    };
    return <a href={href} onClick={onClick}>{children}</a>;
  };
}

function MarkdownView({
  source,
  baseDir = "",
  terms = [],
}: {
  source: string;
  baseDir?: string;
  terms?: string[];
}) {
  const ref = useTermHighlight<HTMLDivElement>(terms, source);
  const components = useMemo<Components>(() => ({
    code: mdCodeComponent,
    img: ({ src, alt }) => <MarkdownImage src={typeof src === "string" ? src : undefined} alt={alt} baseDir={baseDir} />,
    a: makeMdAnchor(baseDir),
  }), [baseDir]);

  // Parsing + highlighting the whole document is ~12ms; memoize the rendered
  // tree so incidental parent re-renders (a content-index-progress storm, say)
  // don't re-run the remark/rehype/hljs pipeline and peg the main thread. Backed
  // by the module-level `treeCache` (keyed source\0baseDir) so the tree also
  // survives remounts when the selected file flips - `components` is a pure
  // function of baseDir, so the same key always yields an equivalent tree.
  const rendered = useMemo(() => {
    const key = treeCacheKey(source, baseDir);
    const hit = treeCache.get(key);
    if (hit) {
      // Refresh insertion order (approximate LRU) on reuse.
      treeCache.delete(key);
      treeCache.set(key, hit);
      return hit;
    }
    const tree = (
      <ReactMarkdown
        remarkPlugins={REMARK}
        rehypePlugins={REHYPE}
        components={components}
      >
        {source}
      </ReactMarkdown>
    );
    treeCache.set(key, tree);
    while (treeCache.size > TREE_CACHE_CAP) {
      const oldest = treeCache.keys().next().value;
      if (oldest === undefined) break;
      treeCache.delete(oldest);
    }
    return tree;
  }, [source, baseDir, components]);

  return (
    <div className="md-preview-wrap" ref={ref} key={`${source}${terms.join("")}`}>
      {rendered}
    </div>
  );
}

export default memo(MarkdownView);
