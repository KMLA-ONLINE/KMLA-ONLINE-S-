import { useSyncExternalStore } from "react";

export type PromptSource = "service-worker" | "install" | "notification";

const active = new Set<PromptSource>();
const listeners = new Set<() => void>();

export function setPromptActive(source: PromptSource, value: boolean): void {
  const changed = value ? !active.has(source) : active.has(source);
  if (!changed) return;
  if (value) active.add(source);
  else active.delete(source);
  for (const listener of listeners) listener();
}

export function useOtherPromptActive(source: PromptSource): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => [...active].some((item) => item !== source),
    () => false,
  );
}

export function usePromptActive(source: PromptSource): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => active.has(source),
    () => false,
  );
}
