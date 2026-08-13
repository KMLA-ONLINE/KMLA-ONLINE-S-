import { describe, expect, it } from "vitest";

import { GroupDetailMobileHeader } from "~/features/groups/components/group-detail-mobile-header";
import { renderRoute, screen } from "../../../router";

describe("GroupDetailMobileHeader", () => {
  it("opens group post search for members", async () => {
    const { user } = renderRoute(() => (
      <GroupDetailMobileHeader
        name="테스트 그룹"
        iconPath={null}
        groupId="group-1"
        slug="test-group"
        canSearch
      />
    ));

    await user.click(screen.getByRole("button", { name: "게시물 검색" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "게시물 검색어" }),
    ).toBeVisible();
  });

  it("hides search from non-members", () => {
    renderRoute(() => (
      <GroupDetailMobileHeader
        name="테스트 그룹"
        iconPath={null}
        groupId="group-1"
        slug="test-group"
        canSearch={false}
      />
    ));

    expect(
      screen.queryByRole("button", { name: "게시물 검색" }),
    ).not.toBeInTheDocument();
  });
});
