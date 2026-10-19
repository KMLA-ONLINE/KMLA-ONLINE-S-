import { describe, expect, it, vi } from "vitest";
import { fireEvent } from "@testing-library/react";

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

  it("switches tabs with a horizontal swipe on mobile but ignores vertical scrolling", () => {
    window.sessionStorage.clear();
    vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
      matches: query === "(max-width: 767px)",
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    renderRoute(GroupHomeRoute, { path: "/groups" });
    const officialList = screen.getByText("표시할 공식 그룹이 없습니다.");

    fireEvent.touchStart(officialList, {
      touches: [{ clientX: 250, clientY: 250 }],
    });
    fireEvent.touchEnd(officialList, {
      changedTouches: [{ clientX: 245, clientY: 100 }],
    });
    expect(screen.getByRole("button", { name: "공식" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    fireEvent.touchStart(officialList, {
      touches: [{ clientX: 250, clientY: 250 }],
    });
    fireEvent.touchEnd(officialList, {
      changedTouches: [{ clientX: 90, clientY: 260 }],
    });
    expect(screen.getByRole("button", { name: "비공식" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    const unofficialList = screen.getByText(
      "아직 참여 중인 비공식 그룹이 없습니다.",
    );
    fireEvent.touchStart(unofficialList, {
      touches: [{ clientX: 90, clientY: 260 }],
    });
    fireEvent.touchEnd(unofficialList, {
      changedTouches: [{ clientX: 250, clientY: 250 }],
    });
    expect(screen.getByRole("button", { name: "공식" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
