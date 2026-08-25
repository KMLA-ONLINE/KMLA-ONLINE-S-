import { describe, expect, it } from "vitest";

import { GroupHomeScreen } from "~/features/groups/components/group-home-screen";
import { renderRoute, screen } from "../../../router";

function GroupHomeRoute() {
  return <GroupHomeScreen groups={[]} isTeacher={false} profileId={1} />;
}

describe("GroupHomeScreen", () => {
  it("restores the unofficial tab after returning to the group home", () => {
    window.sessionStorage.clear();
    const { unmount } = renderRoute(GroupHomeRoute, {
      path: "/groups",
      initialEntries: ["/groups?tab=unofficial"],
    });

    expect(screen.getByRole("button", { name: "비공식" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    unmount();

    renderRoute(GroupHomeRoute, {
      path: "/groups",
      initialEntries: ["/groups"],
    });

    expect(screen.getByRole("button", { name: "비공식" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("switches from a restored unofficial tab to the official tab", async () => {
    window.sessionStorage.clear();
    const { unmount } = renderRoute(GroupHomeRoute, {
      path: "/groups",
      initialEntries: ["/groups?tab=unofficial"],
    });
    unmount();

    const view = renderRoute(GroupHomeRoute, {
      path: "/groups",
      initialEntries: ["/groups"],
    });

    await view.user.click(screen.getByRole("button", { name: "공식" }));

    expect(screen.getByRole("button", { name: "공식" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
