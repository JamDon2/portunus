import { createContext } from "react";

// Whether file/folder glyphs are tinted by category (config `[files]
// colored_icons`). Shared by the result list (ResultIcon) and the folder
// preview (FolderRow) so both render identical glyphs. Default on.
export const ColoredIconsContext = createContext(true);
