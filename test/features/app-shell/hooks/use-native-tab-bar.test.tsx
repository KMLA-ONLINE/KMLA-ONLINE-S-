import { useSyncExternalStore } from "react";
import { useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useNativeTabBar } from "~/features/app-shell/hooks/use-native-tab-bar";
import { act, renderRoute, screen } from "../../../router";

const plugin = vi.hoisted(() => {
  const listeners: ((event: { id: string }) => void)[] = [];
  const remove = vi.fn(() => Promise.resolve());

  return {
    listeners,
    remove,
    TabBar: {
      setTabs: vi.fn(() => Promise.resolve()),
      show: vi.fn(() => Promise.resolve()),
      hide: vi.fn(() => Promise.resolve()),
      selectTabById: vi.fn(() => Promise.resolve()),
      addListener: vi.fn(
        (_event: string, listener: (event: { id: string }) => void) => {
          listeners.push(listener);
          return Promise.resolve({ remove });
        },
      ),
    },
  };
});

const state = vi.hoisted(() => {
  const badges: Record<string, number> = {};
  return { badges };
});

vi.mock("@capawesome/capacitor-tab-bar", () => ({ TabBar: plugin.TabBar }));
vi.mock("~/features/app-shell/context/app-shell-context", () => ({
  useNavBadges: () => state.badges,
}));

// 훅의 인자는 셸이 route마다 바꾸므로, 렌더 사이에 바꿀 수 있는 작은 외부 저장소로 흉내 낸다.
let snapshot = { enabled: true, visible: true };
const controlListeners = new Set<() => void>();

function setControl(patch: Partial<typeof snapshot>) {
  snapshot = { ...snapshot, ...patch };
  controlListeners.forEach((listener) => listener());
}

function useControl() {
  return useSyncExternalStore(
    (listener) => {
      controlListeners.add(listener);
      return () => controlListeners.delete(listener);
    },
    () => snapshot,
  );
}

// jsdom의 `matchMedia`는 무엇을 묻든 `matches: false`다. md 경계 쿼리만 골라 답하고 변경 이벤트를 흉내 낸다.
let wide = false;
const mediaListeners = new Set<(event: { matches: boolean }) => void>();

function stubMatchMedia() {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: query === "(min-width: 768px)" && wide,
        media: query,
        addEventListener: (
          _type: string,
          listener: (event: { matches: boolean }) => void,
        ) => {
          mediaListeners.add(listener);
        },
        removeEventListener: (
          _type: string,
          listener: (event: { matches: boolean }) => void,
        ) => {
          mediaListeners.delete(listener);
        },
      }) as unknown as MediaQueryList,
  );
}

function setWide(value: boolean) {
  wide = value;
  mediaListeners.forEach((listener) => listener({ matches: value }));
}

const scrollTo = vi.fn();
const scrollRef = {
  current: Object.assign(document.createElement("main"), { scrollTo }),
};

function Screen() {
  const { enabled, visible } = useControl();
  const location = useLocation();
  useNativeTabBar({ enabled, visible, scrollRef });

  return <p data-testid="location">{location.pathname + location.search}</p>;
}

function renderShell(path: string) {
  return renderRoute(Screen, { path: "*", initialEntries: [path] });
}

function selectNativeTab(id: string) {
  act(() => {
    plugin.listeners.forEach((listener) => listener({ id }));
  });
}

describe("useNativeTabBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin.listeners.length = 0;
    state.badges = {};
    snapshot = { enabled: true, visible: true };
    wide = false;
    mediaListeners.clear();
    stubMatchMedia();
  });

  it("다섯 탭을 경로 id와 SF Symbol로 등록하고 안 읽음 수를 뱃지로 붙인다", async () => {
    state.badges = { "/messenger": 3, "/noti": 120 };

    renderShell("/");

    await vi.waitFor(() => expect(plugin.TabBar.setTabs).toHaveBeenCalled());
    expect(plugin.TabBar.setTabs).toHaveBeenLastCalledWith({
      tabs: [
        { id: "/", title: "홈", systemImage: "house" },
        {
          id: "/messenger",
          title: "메시지",
          systemImage: "bubble.left.and.bubble.right",
          badge: "3",
        },
        { id: "/groups", title: "그룹", systemImage: "person.2" },
        { id: "/noti", title: "알림", systemImage: "bell", badge: "99+" },
        { id: "/menu", title: "메뉴", systemImage: "square.grid.2x2" },
      ],
    });
  });

  it("현재 경로가 속한 탭을 선택한다", async () => {
    renderShell("/settings/noti");

    await vi.waitFor(() =>
      expect(plugin.TabBar.selectTabById).toHaveBeenCalledWith({
        id: "/menu",
      }),
    );
  });

  it("화면이 하단 nav를 쓰면 보이고, 쓰지 않으면 숨긴다", async () => {
    renderShell("/");
    await vi.waitFor(() => expect(plugin.TabBar.show).toHaveBeenCalled());
    expect(plugin.TabBar.hide).not.toHaveBeenCalled();

    act(() => setControl({ visible: false }));

    await vi.waitFor(() => expect(plugin.TabBar.hide).toHaveBeenCalled());
  });

  it("md 이상 폭에서는 하단 nav 화면이라도 숨기고, 좁아지면 다시 보인다", async () => {
    wide = true;

    renderShell("/");

    await vi.waitFor(() => expect(plugin.TabBar.hide).toHaveBeenCalled());
    expect(plugin.TabBar.show).not.toHaveBeenCalled();

    act(() => setWide(false));

    await vi.waitFor(() => expect(plugin.TabBar.show).toHaveBeenCalled());
  });

  it("네이티브 탭을 누르면 그 탭으로 이동한다", async () => {
    renderShell("/");
    await vi.waitFor(() => expect(plugin.listeners).toHaveLength(1));

    selectNativeTab("/groups");

    expect(await screen.findByTestId("location")).toHaveTextContent(
      /^\/groups$/,
    );
  });

  it("그 탭의 첫 화면에서 같은 탭을 누르면 이동하지 않고 맨 위로 올린다", async () => {
    renderShell("/");
    await vi.waitFor(() => expect(plugin.listeners).toHaveLength(1));

    selectNativeTab("/");

    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }));
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/);
  });

  it("같은 탭이라도 주소에 쿼리가 붙어 있으면 첫 화면으로 돌아간다", async () => {
    renderShell("/groups?tab=members");
    await vi.waitFor(() => expect(plugin.listeners).toHaveLength(1));

    selectNativeTab("/groups");

    expect(await screen.findByTestId("location")).toHaveTextContent(
      /^\/groups$/,
    );
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("네이티브 셸이 아니면 플러그인을 부르지 않는다", async () => {
    snapshot = { enabled: false, visible: true };

    renderShell("/");
    await act(async () => {
      await Promise.resolve();
    });

    expect(plugin.TabBar.setTabs).not.toHaveBeenCalled();
    expect(plugin.TabBar.show).not.toHaveBeenCalled();
    expect(plugin.TabBar.addListener).not.toHaveBeenCalled();
  });

  it("셸이 사라지면 탭바를 숨기고 리스너를 뗀다", async () => {
    const { unmount } = renderShell("/");
    await vi.waitFor(() => expect(plugin.TabBar.show).toHaveBeenCalled());

    unmount();

    await vi.waitFor(() => expect(plugin.TabBar.hide).toHaveBeenCalled());
    await vi.waitFor(() => expect(plugin.remove).toHaveBeenCalled());
  });
});
