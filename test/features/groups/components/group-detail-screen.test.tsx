import { useLocation } from "react-router";
import { describe, expect, it } from "vitest";

import { GroupDetailScreen } from "~/features/groups/components/group-detail-screen";
import type { GroupDetail } from "~/features/groups/model/types";
import { renderRoute, screen } from "../../../router";

const baseGroup: GroupDetail = {
  id: "7ba5eb3b-cb00-4d8d-8cc7-607fb089be25",
  group_id: "7ba5eb3b-cb00-4d8d-8cc7-607fb089be25",
  slug: "test-group",
  name: "테스트 그룹",
  description: "그룹 설명",
  kind: "unofficial",
  join_policy: "open",
  identity_policy: "identified",
  posting_policy: "members",
  icon_path: null,
  cover_path: null,
  member_count: 12,
  membership_state: "member",
  member_role: "member",
  requested_at: null,
  pinned_at: null,
};

function DetailHarness({ group = baseGroup }: { group?: GroupDetail }) {
  const location = useLocation();

  return (
    <>
      <span data-testid="location-search">{location.search}</span>
      <GroupDetailScreen group={group} profileId={1} isTeacher={false} />
    </>
  );
}

describe("GroupDetailScreen", () => {
  it("shows the post tab by default without repeating the member role", () => {
    renderRoute(DetailHarness, {
      path: "/groups/:slug",
      initialEntries: ["/groups/test-group"],
    });

    expect(screen.getByRole("button", { name: "게시물" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByText("아직 게시물이 없습니다")).toBeInTheDocument();
    expect(screen.getByText(/공개 그룹/)).toHaveTextContent(
      "공개 그룹 · 멤버 12명",
    );
    expect(screen.getByText(/공개 그룹/)).not.toHaveTextContent(
      "멤버 12명 · 멤버",
    );
  });

  it("stores the selected member tab in the URL", async () => {
    const { user } = renderRoute(DetailHarness, {
      path: "/groups/:slug",
      initialEntries: ["/groups/test-group"],
    });

    await user.click(screen.getByRole("button", { name: "멤버" }));

    expect(screen.getByTestId("location-search")).toHaveTextContent(
      "?tab=members",
    );
    expect(
      screen.getByText("멤버 명부 기능을 준비하고 있습니다."),
    ).toBeInTheDocument();
  });

  it("shows settings and an anonymized member directory to managers", () => {
    const { unmount } = renderRoute(DetailHarness, {
      path: "/groups/:slug",
      initialEntries: ["/groups/test-group?tab=members"],
    });

    expect(
      screen.queryByRole("button", { name: "그룹 설정" }),
    ).not.toBeInTheDocument();
    unmount();

    const anonymousManager = {
      ...baseGroup,
      identity_policy: "always_anonymous" as const,
      member_role: "manager" as const,
    };

    renderRoute(() => <DetailHarness group={anonymousManager} />, {
      path: "/groups/:slug",
      initialEntries: ["/groups/test-group?tab=members"],
    });

    expect(screen.getByRole("button", { name: "멤버" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "그룹 설정" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("멤버 명부 기능을 준비하고 있습니다."),
    ).toBeInTheDocument();
  });
});
