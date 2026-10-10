import { useLocation } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { MobileTabBar } from "~/features/app-shell/components/mobile-tab-bar";
import { renderRoute, screen } from "../../../router";

vi.mock("~/features/app-shell/context/app-shell-context", () => ({
  useNavBadges: () => ({}),
}));

function renderTabBar(path: string) {
  const scroller = document.createElement("main");
  const scrollTo = vi.spyOn(scroller, "scrollTo");

  function Screen() {
    const location = useLocation();
    return (
      <>
        <p data-testid="location">{location.pathname + location.search}</p>
        <MobileTabBar scrollRef={{ current: scroller }} />
      </>
    );
  }

  const view = renderRoute(Screen, { path: "*", initialEntries: [path] });

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

    expect(await screen.findByTestId("location")).toHaveTextContent(
      /^\/groups$/,
    );
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("returns to the tab's first screen when the URL carries extra state", async () => {
    const { user, scrollTo } = renderTabBar("/groups?tab=members");

    await user.click(screen.getByRole("link", { name: "그룹" }));

    expect(await screen.findByTestId("location")).toHaveTextContent(
      /^\/groups$/,
    );
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("leaves modified clicks to the browser", async () => {
    const { user, scrollTo } = renderTabBar("/");

    await user.keyboard("{Control>}");
    await user.click(screen.getByRole("link", { name: "홈" }));
    await user.keyboard("{/Control}");

    expect(scrollTo).not.toHaveBeenCalled();
  });
});
