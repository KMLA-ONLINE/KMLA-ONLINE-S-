import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useStaleChunkRecovery } from "~/shared/hooks/use-stale-chunk-recovery";

/** Vite가 지연 import 실패에서 내보내는 것과 같은 모양의 이벤트. */
function firePreloadError(): Event {
  const event = new Event("vite:preloadError", { cancelable: true });
  window.dispatchEvent(event);
  return event;
}

describe("useStaleChunkRecovery", () => {
  beforeEach(() => {
    vi.stubEnv("PROD", true);
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    sessionStorage.clear();
  });

  it("사라진 청크를 만나면 오류를 막고 새로고침한다", () => {
    const reload = vi.fn();
    renderHook(() => useStaleChunkRecovery(reload));

    const event = firePreloadError();

    expect(event.defaultPrevented).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("이동 중에 실패하면 지금 화면 대신 가려던 화면을 연다", () => {
    const reload = vi.fn();
    const pending = {
      current: {
        pathname: "/groups/a",
        search: "?tab=posts",
        hash: "",
        state: { from: "group" },
        key: "next",
      },
    };
    window.history.replaceState({ usr: null, key: "default", idx: 3 }, "", "/");
    renderHook(() => useStaleChunkRecovery(reload, pending));

    firePreloadError();

    expect(window.location.pathname + window.location.search).toBe(
      "/groups/a?tab=posts",
    );
    expect(window.history.state).toEqual({
      usr: { from: "group" },
      key: "next",
      idx: 4,
    });
    expect(reload).toHaveBeenCalledOnce();
  });

  it("되살린 직후 또 실패하면 손을 떼고 오류를 흘려보낸다", () => {
    const { unmount } = renderHook(() => useStaleChunkRecovery(vi.fn()));
    firePreloadError();
    unmount();

    // 새로고침으로 페이지가 다시 뜬 상황. 훅은 새로 마운트되지만 표시는 세션에 남는다.
    const reloadAgain = vi.fn();
    renderHook(() => useStaleChunkRecovery(reloadAgain));
    const event = firePreloadError();

    expect(event.defaultPrevented).toBe(false);
    expect(reloadAgain).not.toHaveBeenCalled();
  });

  it("개발 모드에서는 오류를 그대로 둔다", () => {
    vi.stubEnv("PROD", false);
    const reload = vi.fn();
    renderHook(() => useStaleChunkRecovery(reload));

    const event = firePreloadError();

    expect(event.defaultPrevented).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("언마운트한 뒤에는 듣지 않는다", () => {
    const reload = vi.fn();
    const { unmount } = renderHook(() => useStaleChunkRecovery(reload));

    unmount();
    firePreloadError();

    expect(reload).not.toHaveBeenCalled();
  });
});
