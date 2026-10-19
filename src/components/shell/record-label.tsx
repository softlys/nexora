"use client";

import { useEffect, useSyncExternalStore } from "react";

/**
 * Lets a record page tell the breadcrumbs and the browser tab what the record is called,
 * so "/companies/3f2…" shows "Companies / Brennholt Foundry Works".
 */
const labels = new Map<string, string>();
const listeners = new Set<() => void>();
let version = 0;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useRecordLabels(): Map<string, string> {
  useSyncExternalStore(
    subscribe,
    () => version,
    () => 0,
  );
  return labels;
}

export function RecordLabel({ path, label }: { path: string; label: string }) {
  useEffect(() => {
    labels.set(path, label);
    version++;
    listeners.forEach((l) => l());
    const previous = document.title;
    document.title = `${label} · NEXORA`;
    return () => {
      document.title = previous;
    };
  }, [path, label]);
  return null;
}
