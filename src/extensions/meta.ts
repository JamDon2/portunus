// Launcher-side extension metadata store: one lazy `list_extensions` fetch,
// shared by group labels, trigger chips, footer hints and the action picker.
//
// Module-level cache + useSyncExternalStore, mirroring the ExtensionPreview
// cache: refetched on `extensions-reloaded` (a real reload), deliberately NOT
// on `search-invalidated` (fires on unrelated filesystem churn).

import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ExtensionInfo } from "../types";

let cache: ExtensionInfo[] = [];
let started = false;
const listeners = new Set<() => void>();

function refetch() {
  invoke<ExtensionInfo[]>("list_extensions")
    .then(list => {
      cache = list;
      listeners.forEach(l => l());
    })
    .catch(() => {});
}

function ensureStarted() {
  if (started) return;
  started = true;
  refetch();
  void listen("extensions-reloaded", refetch);
}

const subscribe = (cb: () => void) => {
  ensureStarted();
  listeners.add(cb);
  return () => void listeners.delete(cb);
};

/** Reactive list of installed extensions (empty until the first fetch lands). */
export function useExtensionMeta(): ExtensionInfo[] {
  return useSyncExternalStore(subscribe, () => cache);
}

/** Sync lookup for non-hook call sites (groupLabel). Starts the fetch lazily. */
export function extensionByKind(kind: string): ExtensionInfo | undefined {
  ensureStarted();
  return cache.find(e => e.kind === kind);
}
