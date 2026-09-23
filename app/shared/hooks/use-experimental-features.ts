import { useState } from "react";

const STORAGE_KEY = "kmla-online:experimental-features:v1";

export function useExperimentalFeatures(): [
  boolean,
  (enabled: boolean) => void,
] {
  const [enabled, setEnabled] = useState(
    () =>
      typeof window !== "undefined" &&
      window.localStorage.getItem(STORAGE_KEY) === "true",
  );

  function setExperimentalFeatures(next: boolean): void {
    window.localStorage.setItem(STORAGE_KEY, String(next));
    setEnabled(next);
  }

  return [enabled, setExperimentalFeatures];
}
