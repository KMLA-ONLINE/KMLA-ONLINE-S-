import { useSyncExternalStore } from "react";

// 셸의 Tailwind md breakpoint와 동일하다.
const DESKTOP_QUERY = "(min-width: 768px)";

function subscribe(onChange: () => void) {
  const query = window.matchMedia(DESKTOP_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function getSnapshot() {
  return window.matchMedia(DESKTOP_QUERY).matches;
}

export function useDesktopShell() {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
