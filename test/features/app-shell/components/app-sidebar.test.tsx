import { afterEach, describe, expect, it, vi } from "vitest";

import { AppShellProvider, type ShellData } from "~/features/app-shell";
import { AppSidebar } from "~/features/app-shell/components/app-sidebar";
import { renderRoute, screen, within } from "../../../router";

const shell = {
  email: "student@kmla.hs.kr",
  profile: {
    id: 1,
    pub_id: "student",
    name: "홍길동",
    role: "member",
    type: "student",
    status: "accepted",
    avatar_path: null,
    terms_agreed_at: "2026-10-20T00:00:00+00:00",
  },
} satisfies ShellData;

describe("desktop navigation", () => {
  it.each(["/menu", "/menu/meal"])(
    "offers an active menu entry at %s",
    (path) => {
      renderRoute(
        () => (
          <AppShellProvider value={shell}>
            <AppSidebar onHomeReselect={() => undefined} />
          </AppShellProvider>
        ),
        { path },
      );
      const nav = within(screen.getByRole("navigation", { name: "주요 메뉴" }));
      expect(nav.getAllByRole("link")).toHaveLength(5);
      for (const name of ["홈", "메시지", "그룹", "알림"]) {
        expect(nav.getByRole("link", { name })).toBeInTheDocument();
      }
      expect(nav.getByRole("link", { name: "메뉴" })).toHaveAttribute(
        "href",
        "/menu",
      );
      expect(nav.getByRole("link", { name: "메뉴" })).toHaveAttribute(
        "aria-current",
        "page",
      );
    },
  );

  it("refreshes instead of navigating when home is clicked on home", async () => {
    const onHomeReselect = vi.fn();
    const { user } = renderRoute(
      () => (
        <AppShellProvider value={shell}>
          <AppSidebar onHomeReselect={onHomeReselect} />
        </AppShellProvider>
      ),
      { path: "/" },
    );

    await user.click(screen.getByRole("link", { name: "홈" }));

    expect(onHomeReselect).toHaveBeenCalledTimes(1);
  });

  it("navigates home without refreshing from another tab", async () => {
    const onHomeReselect = vi.fn();
    const { user } = renderRoute(
      () => (
        <AppShellProvider value={shell}>
          <AppSidebar onHomeReselect={onHomeReselect} />
        </AppShellProvider>
      ),
      {
        path: "/menu",
        routes: [{ path: "/", Component: () => <p>홈 화면</p> }],
      },
    );

    await user.click(screen.getByRole("link", { name: "홈" }));

    expect(await screen.findByText("홈 화면")).toBeInTheDocument();
    expect(onHomeReselect).not.toHaveBeenCalled();
  });

  it("lets home override a navigation that is still loading", async () => {
    const onHomeReselect = vi.fn();
    const { user } = renderRoute(
      () => (
        <AppShellProvider value={shell}>
          <AppSidebar onHomeReselect={onHomeReselect} />
        </AppShellProvider>
      ),
      {
        path: "/",
        routes: [
          {
            path: "/groups",
            loader: () => new Promise(() => undefined),
            Component: () => <p>그룹 화면</p>,
          },
        ],
      },
    );

    await user.click(screen.getByRole("link", { name: "그룹" }));
    await user.click(screen.getByRole("link", { name: "홈" }));

    expect(onHomeReselect).not.toHaveBeenCalled();
  });
});

describe("desktop navigation in English", () => {
  afterEach(() => window.localStorage.clear());

  it("names the navigation and its links in English", () => {
    window.localStorage.setItem("kmla-online:language:v1", "en");
    renderRoute(
      () => (
        <AppShellProvider value={shell}>
          <AppSidebar onHomeReselect={() => undefined} />
        </AppShellProvider>
      ),
      { path: "/" },
    );
    const nav = within(screen.getByRole("navigation", { name: "Main menu" }));
    for (const name of [
      "Home",
      "Messages",
      "Groups",
      "Notifications",
      "Menu",
    ]) {
      expect(nav.getByRole("link", { name })).toBeInTheDocument();
    }
  });
});
