import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useShellRefresh } from "~/features/app-shell/hooks/use-shell-refresh";

describe("useShellRefresh", () => {
  afterEach(() => vi.useRealTimers());

  it("skips a second entry point while a refresh is running", async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const onRefresh = vi.fn(
      () => new Promise<void>((resolve) => (finish = resolve)),
    );
    const { result } = renderHook(() => useShellRefresh(onRefresh));

    let started: boolean[] = [];
    act(() => {
      started = [result.current.refresh(), result.current.refresh()];
    });

    expect(started).toEqual([true, false]);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(result.current.refreshing).toBe(true);

    await act(async () => {
      finish();
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(result.current.refreshing).toBe(false);
    act(() => {
      expect(result.current.refresh()).toBe(true);
    });
  });
});
