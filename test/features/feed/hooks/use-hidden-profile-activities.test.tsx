import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useHiddenProfileActivities } from "~/features/feed/hooks/use-hidden-profile-activities";
import { HIDDEN_PROFILE_ACTIVITIES_STORAGE_KEY } from "~/shared/lib/user-scoped-storage";

const POST_ID = "11111111-1111-4111-8111-111111111111";

describe("hidden profile activity preferences", () => {
  beforeEach(() => window.localStorage.clear());

  it("does not reuse the previous account's preferences when the feed was unmounted during account cleanup", () => {
    const { result, unmount } = renderHook(() => useHiddenProfileActivities());
    act(() => result.current.hide(POST_ID));
    expect(result.current.hiddenIds.has(POST_ID)).toBe(true);
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
    expect(nextResult.current.hiddenIds.size).toBe(0);
  });

  it("hides an activity, remembers it on the device, and undoes it", () => {
    const { result } = renderHook(() => useHiddenProfileActivities());
    act(() => result.current.hide(POST_ID));
    expect(result.current.hiddenIds.has(POST_ID)).toBe(true);
    expect(
      window.localStorage.getItem(HIDDEN_PROFILE_ACTIVITIES_STORAGE_KEY),
    ).toBe(JSON.stringify([POST_ID]));

    act(() => result.current.unhide(POST_ID));
    expect(result.current.hiddenIds.has(POST_ID)).toBe(false);
  });
});
