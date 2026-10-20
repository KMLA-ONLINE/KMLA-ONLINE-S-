import { useCallback, useEffect, useSyncExternalStore } from "react";

import {
  activeHiddenProfileActivities,
  hideProfileActivity,
  parseHiddenProfileActivities,
  unhideProfileActivity,
  type HiddenProfileActivity,
} from "~/features/feed/model/hidden-profile-activities";
import { HIDDEN_PROFILE_ACTIVITIES_STORAGE_KEY } from "~/shared/lib/user-scoped-storage";

const CHANGE_EVENT = "kmla-online:hidden-profile-activities-change";
const EMPTY: readonly HiddenProfileActivity[] = [];
let snapshot: readonly HiddenProfileActivity[] = EMPTY;
let storedSnapshot: string | null | undefined;

function getSnapshot(): readonly HiddenProfileActivity[] {
  try {
    const raw = window.localStorage.getItem(
      HIDDEN_PROFILE_ACTIVITIES_STORAGE_KEY,
    );
    // Account cleanup can happen while the feed is unmounted and has no storage listener.
    if (raw !== storedSnapshot) {
      storedSnapshot = raw;
      snapshot = parseHiddenProfileActivities(raw);
    }
  } catch {
    // Keep the in-memory preference if storage is unavailable.
  }
  return snapshot;
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (
      event.key !== HIDDEN_PROFILE_ACTIVITIES_STORAGE_KEY &&
      event.key !== null
    )
      return;
    storedSnapshot = undefined;
    onChange();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function update(next: HiddenProfileActivity[]) {
  snapshot = next;
  try {
    const raw = JSON.stringify(next);
    window.localStorage.setItem(HIDDEN_PROFILE_ACTIVITIES_STORAGE_KEY, raw);
    storedSnapshot = raw;
  } catch {
    // Private browsing can disable storage. The in-memory preference still works.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useHiddenProfileActivities() {
  const entries = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);

  // A hidden card reappears at 24h even when the feed remains open.
  useEffect(() => {
    const nextExpiry = Math.min(...entries.map((entry) => entry.hiddenUntil));
    const timer = Number.isFinite(nextExpiry)
      ? window.setTimeout(
          () => {
            update(activeHiddenProfileActivities(getSnapshot()));
          },
          Math.max(0, nextExpiry - Date.now()),
        )
      : null;
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        const current = getSnapshot();
        const active = activeHiddenProfileActivities(current);
        if (active.length !== current.length) update(active);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [entries]);

  const hide = useCallback((postId: string) => {
    update(hideProfileActivity(getSnapshot(), postId));
  }, []);
  const unhide = useCallback((postId: string) => {
    update(unhideProfileActivity(getSnapshot(), postId));
  }, []);

  return { entries, hide, unhide };
}
