import { useSyncExternalStore } from "react";

const WIDE_HOME_QUERY = "(min-width: 1024px)";

export function isWideHome() {
  return (
    typeof window !== "undefined" && window.matchMedia(WIDE_HOME_QUERY).matches
  );
}

function subscribe(onChange: () => void) {
  const query = window.matchMedia(WIDE_HOME_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export function useWideHome() {
  return useSyncExternalStore(subscribe, isWideHome, () => false);
}
