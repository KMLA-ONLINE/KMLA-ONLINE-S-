import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useHiddenProfileActivities } from "~/features/feed/hooks/use-hidden-profile-activities";
import { HIDDEN_PROFILE_ACTIVITIES_STORAGE_KEY } from "~/shared/lib/user-scoped-storage";

const POST_ID = "11111111-1111-4111-8111-111111111111";

describe("hidden profile activity preferences", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-21T00:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("does not reuse the previous account's preferences when the feed was unmounted during account cleanup", () => {
    const { result, unmount } = renderHook(() => useHiddenProfileActivities());
    act(() => result.current.hide(POST_ID));
    expect(result.current.entries).toHaveLength(1);
    unmount();

    window.localStorage.removeItem(HIDDEN_PROFILE_ACTIVITIES_STORAGE_KEY);
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: HIDDEN_PROFILE_ACTIVITIES_STORAGE_KEY,
        newValue: null,
      }),
    );

    const { result: nextResult } = renderHook(() =>
      useHiddenProfileActivities(),
    );
    expect(nextResult.current.entries).toEqual([]);
  });

  it("shows a hidden activity again after 24 hours while the feed stays open", () => {
    const { result } = renderHook(() => useHiddenProfileActivities());
    act(() => result.current.hide(POST_ID));
    expect(result.current.entries).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    });
    expect(result.current.entries).toEqual([]);
  });
});
