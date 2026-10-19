import { describe, expect, it, vi } from "vitest";
import { fireEvent } from "@testing-library/react";

import { GroupHomeScreen } from "~/features/groups/components/group-home-screen";
import type { GroupHomeItem } from "~/features/groups/model/types";
import { renderRoute, screen } from "../../../router";

function GroupHomeRoute() {
  return (
    <GroupHomeScreen
      groups={[]}
      newPostCounts={{}}
      isTeacher={false}
      profileId={1}
    />
  );
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

  it("keeps the pin dialog and selected tab when swiping inside the dialog", async () => {
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
    const group: GroupHomeItem = {
      id: "group-1",
      group_id: "group-1",
      slug: "test-group",
      name: "테스트 그룹",
      description: "설명",
      kind: "official",
      join_policy: "open",
      identity_policy: "identified",
      posting_policy: "members",
      icon_path: null,
      cover_path: null,
      member_count: 12,
      membership_state: "member",
      member_role: null,
      pinned_at: null,
      section: "official",
    };
    const { user } = renderRoute(
      () => (
        <GroupHomeScreen
          groups={[group]}
          newPostCounts={{}}
          isTeacher={false}
          profileId={1}
        />
      ),
      { path: "/groups" },
    );
    const officialTab = screen.getByRole("button", { name: "공식" });
    await user.pointer({
      keys: "[TouchA>]",
      target: screen.getByRole("link", { name: group.name }),
    });
    const dialog = await screen.findByRole("dialog");
    await user.pointer({ keys: "[/TouchA]" });

    fireEvent.touchStart(dialog, {
      touches: [{ clientX: 250, clientY: 250 }],
    });
    fireEvent.touchEnd(dialog, {
      changedTouches: [{ clientX: 90, clientY: 260 }],
    });

    expect(officialTab).toHaveAttribute("aria-current", "page");
    expect(dialog).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "취소" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
