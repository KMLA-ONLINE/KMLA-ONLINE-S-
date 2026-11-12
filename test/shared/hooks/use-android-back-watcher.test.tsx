import { act } from "@testing-library/react";
import { Link } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAndroidBackWatcher } from "~/shared/hooks/use-android-back-watcher";
import { renderRoute, screen, userEvent } from "../../router";

/** 브라우저의 CloseWatcher 대역. OS 뒤로가기는 가장 최근의 살아 있는 watcher에 `close`로 온다. */
class FakeCloseWatcher {
  static all: FakeCloseWatcher[] = [];
  destroyed = false;
  private listeners: (() => void)[] = [];

  constructor() {
    FakeCloseWatcher.all.push(this);
  }

  addEventListener(type: string, listener: () => void) {
    if (type === "close") this.listeners.push(listener);
  }

  destroy() {
    this.destroyed = true;
  }

  static active() {
    return FakeCloseWatcher.all.filter((watcher) => !watcher.destroyed);
  }

  /** OS 뒤로가기. 브라우저는 watcher를 닫은 뒤 `close`를 보낸다. */
  static pressBack() {
    const watcher = FakeCloseWatcher.active().at(-1);
    if (!watcher) return;
    watcher.destroyed = true;
    for (const listener of watcher.listeners) listener();
  }
}

const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

function useUserAgent(userAgent: string) {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(userAgent);
}

/** BrowserRouter가 entry마다 적는 위치. 테스트 라우터는 메모리 router라 직접 적는다. */
function setHistoryIndex(idx: number) {
  window.history.replaceState({ usr: null, key: `k${idx}`, idx }, "");
}

function Screen({ name, next }: { name: string; next?: string }) {
  useAndroidBackWatcher();
  return (
    <>
      <p>{name}</p>
      {next ? <Link to={next}>다음</Link> : null}
    </>
  );
}

beforeEach(() => {
  FakeCloseWatcher.all = [];
  vi.stubGlobal("CloseWatcher", FakeCloseWatcher);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setHistoryIndex(0);
});

describe("useAndroidBackWatcher", () => {
  it("밑에 앱 화면이 있으면 Android OS 뒤로가기를 받아 한 칸 뒤로 간다", () => {
    useUserAgent(ANDROID_UA);
    setHistoryIndex(2);
    const back = vi
      .spyOn(window.history, "back")
      .mockImplementation(() => undefined);
    renderRoute(() => <Screen name="대화방" />);

    act(() => FakeCloseWatcher.pressBack());

    expect(back).toHaveBeenCalledOnce();
  });

  it("맨 아래 화면에서는 받지 않아 OS 뒤로가기가 앱을 닫게 둔다", () => {
    useUserAgent(ANDROID_UA);
    setHistoryIndex(0);
    renderRoute(() => <Screen name="홈" />);

    expect(FakeCloseWatcher.active()).toHaveLength(0);
  });

  it("Android가 아니면 받지 않는다 — 데스크톱의 Esc가 화면을 되돌리면 안 된다", () => {
    useUserAgent(DESKTOP_UA);
    setHistoryIndex(2);
    renderRoute(() => <Screen name="대화방" />);

    expect(FakeCloseWatcher.active()).toHaveLength(0);
  });

  it("한 번 받은 뒤에도 옮겨 간 화면에서 다시 받는다", async () => {
    useUserAgent(ANDROID_UA);
    setHistoryIndex(1);
    const back = vi
      .spyOn(window.history, "back")
      .mockImplementation(() => undefined);
    // 앱에서는 레이아웃이 이 hook을 들고 화면만 바뀐다. 같은 route 안의 이동으로 그 조건을 만든다.
    renderRoute(() => <Screen name="대화방" next="/rooms/b" />, {
      path: "/rooms/:roomId",
      initialEntries: ["/rooms/a"],
    });
    act(() => FakeCloseWatcher.pressBack());
    expect(FakeCloseWatcher.active()).toHaveLength(0);

    setHistoryIndex(2);
    await userEvent.click(screen.getByRole("link", { name: "다음" }));

    expect(FakeCloseWatcher.active()).toHaveLength(1);
    act(() => FakeCloseWatcher.pressBack());
    expect(back).toHaveBeenCalledTimes(2);
  });
});
