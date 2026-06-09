// Small line glyphs for clipboard entry rows + preview tiles. Stroke 1.8 to match
// the folder/file glyphs used elsewhere in result rows.

export const TextLinesIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" width="15" height="15">
    <path d="M4 6h16M4 12h16M4 18h10" />
  </svg>
);

export const JsonIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="15" height="15">
    <path d="M8 4c-2 0-3 1-3 3 0 1.6 0 1.6-1 2.5 1 .9 1 .9 1 2.5 0 2-.5 3-3 3" transform="translate(2 1.5) scale(0.85)" />
    <path d="M16 4c2 0 3 1 3 3 0 1.6 0 1.6 1 2.5-1 .9-1 .9-1 2.5 0 2 .5 3 3 3" transform="translate(-2 1.5) scale(0.85)" />
  </svg>
);

export const LinkIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="15" height="15">
    <path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1" />
    <path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1" />
  </svg>
);

export const ImageGlyphIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="15" height="15">
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="8.5" cy="9.5" r="1.5" />
    <path d="m21 16-5-5L5 20" />
  </svg>
);

export const ClipboardGlyphIcon = ({ size = 22 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width={size} height={size}>
    <rect x="8" y="2" width="8" height="4" rx="1" />
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
  </svg>
);
