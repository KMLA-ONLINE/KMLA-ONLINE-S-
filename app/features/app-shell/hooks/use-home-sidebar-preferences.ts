import { useState } from "react";
import {
  readHomeSidebarPreferences,
  writeHomeSidebarPreferences,
  type HomeSidebarPreferences,
} from "../storage/home-sidebar-preferences";

export function useHomeSidebarPreferences() {
  const [preferences, setPreferences] = useState(readHomeSidebarPreferences);

  function update(key: keyof HomeSidebarPreferences, enabled: boolean) {
    const next = { ...preferences, [key]: enabled };
    writeHomeSidebarPreferences(next);
    setPreferences(next);
  }

  return [preferences, update] as const;
}
