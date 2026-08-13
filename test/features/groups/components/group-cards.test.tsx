import { describe, expect, it } from "vitest";

import { GroupDiscoverCard } from "~/features/groups/components/group-discover-card";
import { GroupMobileDiscoverCard } from "~/features/groups/components/group-mobile-discover-card";
import { GroupSummaryRow } from "~/features/groups/components/group-summary-row";
import type {
  DiscoverGroupItem,
  GroupHomeItem,
} from "~/features/groups/model/types";
import { renderRoute, screen } from "../../../router";

const group: DiscoverGroupItem = {
  group_id: "group-1",
  slug: "test-group",
  name: "테스트 그룹",
  description: "설명",
  join_policy: "request",
  identity_policy: "identified",
  icon_path: null,
  cover_path: null,
  member_count: 12,
  membership_state: "none",
  member_role: null,
  requested_at: null,
  sort_rank: 1,
};

describe("group cards", () => {
  it("shows the join policy on a mobile discover card", () => {
    renderRoute(() => <GroupMobileDiscoverCard group={group} profileId={1} />);

    expect(screen.getByText("승인 가입 · 멤버 12명")).toBeVisible();
  });

  it("shows an open action for members on a discover card", () => {
    renderRoute(() => (
      <GroupDiscoverCard
        group={{ ...group, membership_state: "member" }}
        profileId={1}
      />
    ));

    expect(screen.getByRole("button", { name: "열기" })).toHaveAttribute(
      "href",
      "/groups/test-group",
    );
  });

  it("keeps the narrow pin action keyboard reachable", async () => {
    const { user } = renderRoute(() => (
      <GroupSummaryRow
        group={
          {
            ...group,
            id: group.group_id,
            kind: "unofficial",
            posting_policy: "members",
            membership_state: "member",
            pinned_at: null,
            section: "mine",
          } satisfies GroupHomeItem
        }
        profileId={1}
      />
    ));

    await user.tab();
    await user.tab();
    expect(screen.getByRole("button", { name: "그룹 고정" })).toHaveFocus();
  });
});
