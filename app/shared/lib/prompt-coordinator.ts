import { useSyncExternalStore } from "react";

/**
 * 화면 위에 겹치는 안내. 한 번에 하나만 띄운다(기능 명세 §3.7). 우선순위는 연결 끊김 >
 * 새 버전 > 알림 권한 > 홈 화면 추가이며, 뒤의 것이 앞의 것을 보고 물러난다. 서로를 보고
 * 물러나게 하면 같은 순간에 뜬 둘이 함께 숨었다 함께 뜨기를 되풀이한다.
 */
export type PromptSource =
  "offline" | "service-worker" | "notification" | "install";

const active = new Set<PromptSource>();
const listeners = new Set<() => void>();

export function setPromptActive(source: PromptSource, value: boolean): void {
  const changed = value ? !active.has(source) : active.has(source);
  if (!changed) return;
  if (value) active.add(source);
  else active.delete(source);
  for (const listener of listeners) listener();
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
