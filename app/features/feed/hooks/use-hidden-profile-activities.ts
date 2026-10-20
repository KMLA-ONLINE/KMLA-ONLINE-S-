import { useCallback, useMemo, useSyncExternalStore } from "react";

import {
  hideProfileActivity,
  parseHiddenProfileActivities,
  unhideProfileActivity,
} from "~/features/feed/model/hidden-profile-activities";
import { HIDDEN_PROFILE_ACTIVITIES_STORAGE_KEY } from "~/shared/lib/user-scoped-storage";

const CHANGE_EVENT = "kmla-online:hidden-profile-activities-change";
const EMPTY: readonly string[] = [];
let snapshot: readonly string[] = EMPTY;
let storedSnapshot: string | null | undefined;

function getSnapshot(): readonly string[] {
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

function update(next: string[]) {
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
  const ids = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
  const hiddenIds = useMemo(() => new Set(ids), [ids]);

  const toggle = useCallback((postId: string) => {
    const current = getSnapshot();
    update(
      current.includes(postId)
        ? unhideProfileActivity(current, postId)
        : hideProfileActivity(current, postId),
    );
  }, []);

  return { hiddenIds, toggle };
}
