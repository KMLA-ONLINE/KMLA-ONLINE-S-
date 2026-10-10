import { describe, expect, it, vi } from "vitest";

import { MobileTabBar } from "~/features/app-shell/components/mobile-tab-bar";
import { renderRoute, screen } from "../../../router";

vi.mock("~/features/app-shell/context/app-shell-context", () => ({
  useNavBadges: () => ({}),
}));

function renderTabBar(path: string) {
  const scroller = document.createElement("main");
  const scrollTo = vi.spyOn(scroller, "scrollTo");

  const view = renderRoute(
    () => <MobileTabBar scrollRef={{ current: scroller }} />,
    {
      path: "*",
      initialEntries: [path],
      routes: [{ path: "/groups", Component: () => <p>그룹 목록</p> }],
    },
  );

  return { ...view, scrollTo };
}

describe("MobileTabBar", () => {
  it("scrolls home back to the top instead of reloading it", async () => {
    const { user, scrollTo } = renderTabBar("/");

    await user.click(screen.getByRole("link", { name: "홈" }));

    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }));
  });

  it("still navigates when the tab is not the current screen", async () => {
    const { user, scrollTo } = renderTabBar("/");

    await user.click(screen.getByRole("link", { name: "그룹" }));

    expect(await screen.findByText("그룹 목록")).toBeInTheDocument();
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
