import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RECENT_SEARCH_STORAGE_KEY,
  syncUserScopedStorage,
  TIMETABLE_STORAGE_KEY,
  VISITED_POSTS_STORAGE_KEY,
} from "~/shared/lib/user-scoped-storage";

const DEVICE_PREFERENCE_KEYS = [
  "kmla-online:posts-view:v1",
  "kmla-online:experimental-features:v1",
  "kmla-online:pwa-install-preference",
  "kmla-online:notification-prompt:v1:7",
];
const OWNER_KEY = "kmla-online:storage-owner:v1";
const deleteCache = vi.fn();

async function seedSignedInUser(userId: string): Promise<void> {
  await syncUserScopedStorage(userId);
  window.localStorage.setItem(TIMETABLE_STORAGE_KEY, '{"activeSemester":"1"}');
  window.localStorage.setItem(VISITED_POSTS_STORAGE_KEY, '["post-1"]');
  window.localStorage.setItem(RECENT_SEARCH_STORAGE_KEY, '[{"id":"person-1"}]');
  for (const key of DEVICE_PREFERENCE_KEYS) {
    window.localStorage.setItem(key, "kept");
  }
}

describe("user scoped storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    deleteCache.mockReset();
    deleteCache.mockResolvedValue(true);
    vi.stubGlobal("caches", { delete: deleteCache });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the cache when the same user is still signed in", async () => {
    await seedSignedInUser("user-a");

    await syncUserScopedStorage("user-a");

    expect(window.localStorage.getItem(TIMETABLE_STORAGE_KEY)).toBe(
      '{"activeSemester":"1"}',
    );
  });

  it("drops account data on sign out and keeps device preferences", async () => {
    await seedSignedInUser("user-a");

    await syncUserScopedStorage(null);

    expect(window.localStorage.getItem(TIMETABLE_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(VISITED_POSTS_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(RECENT_SEARCH_STORAGE_KEY)).toBeNull();
    for (const key of DEVICE_PREFERENCE_KEYS) {
      expect(window.localStorage.getItem(key)).toBe("kept");
    }
  });

  /** 로그아웃 없이 탭만 닫고 다른 사람이 로그인하는 경로. */
  it("drops account data when a different user signs in without a sign out", async () => {
    await seedSignedInUser("user-a");

    await syncUserScopedStorage("user-b");

    expect(window.localStorage.getItem(RECENT_SEARCH_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(VISITED_POSTS_STORAGE_KEY)).toBeNull();
  });

  /** 지운 값을 캐시해 둔 같은 탭의 store가 다시 읽을 수 있어야 한다. */
  it("announces every cleared key to the current tab", async () => {
    await seedSignedInUser("user-a");

    const cleared: (string | null)[] = [];
    const listen = (event: StorageEvent) => cleared.push(event.key);
    window.addEventListener("storage", listen);
    await syncUserScopedStorage(null);
    window.removeEventListener("storage", listen);

    expect(cleared).toEqual([
      TIMETABLE_STORAGE_KEY,
      VISITED_POSTS_STORAGE_KEY,
      RECENT_SEARCH_STORAGE_KEY,
    ]);
  });

  it("does not record a new owner before protected-cache deletion finishes", async () => {
    await seedSignedInUser("user-a");
    let finishDelete: ((value: boolean) => void) | undefined;
    deleteCache.mockImplementationOnce(
      () => new Promise<boolean>((resolve) => (finishDelete = resolve)),
    );

    const switchUser = syncUserScopedStorage("user-b");

    expect(window.localStorage.getItem(OWNER_KEY)).toBe("user-a");
    finishDelete!(true);
    await switchUser;
    expect(window.localStorage.getItem(OWNER_KEY)).toBe("user-b");
  });

  it("keeps the previous owner when cache deletion fails so a retry is possible", async () => {
    await seedSignedInUser("user-a");
    deleteCache.mockRejectedValueOnce(new Error("Cache Storage unavailable"));

    await expect(syncUserScopedStorage("user-b")).rejects.toThrow(
      "Cache Storage unavailable",
    );
    expect(window.localStorage.getItem(OWNER_KEY)).toBe("user-a");

    await syncUserScopedStorage("user-b");
    expect(window.localStorage.getItem(OWNER_KEY)).toBe("user-b");
  });
});
