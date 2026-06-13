import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { DepStatus } from "../../types";

/**
 * Shared optional-dependency status, fetched once for the whole settings window.
 * Replaces the three independent `check_dependencies` calls that Providers,
 * Clipboard, and Dictionary each used to make. `null` = still loading.
 */
const DepsCtx = createContext<DepStatus[] | null>(null);

export function DepsProvider({ children }: { children: ReactNode }) {
  const [deps, setDeps] = useState<DepStatus[] | null>(null);
  useEffect(() => {
    invoke<DepStatus[]>("check_dependencies").then(setDeps).catch(() => setDeps([]));
  }, []);
  return <DepsCtx.Provider value={deps}>{children}</DepsCtx.Provider>;
}

export function useDeps(): DepStatus[] | null {
  return useContext(DepsCtx);
}

export function useDep(id: string): DepStatus | undefined {
  return useDeps()?.find(d => d.id === id) ?? undefined;
}
