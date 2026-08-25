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

function DetailHarness({
  group = baseGroup,
  isTeacher = false,
}: {
  group?: GroupDetail;
  isTeacher?: boolean;
}) {
  const location = useLocation();

  return (
    <>
      <span data-testid="location-search">{location.search}</span>
      <GroupDetailScreen
        group={group}
        profileId={1}
        viewerName="홍길동"
        viewerAvatarUrl={null}
        isTeacher={isTeacher}
      />
    </>
  );
}

describe("GroupDetailScreen", () => {
  it("does not show a separator before the only official group option", async () => {
    const { user } = renderRoute(
      () => <DetailHarness group={{ ...baseGroup, kind: "official" }} />,
      {
        path: "/groups/:slug",
        initialEntries: ["/groups/test-group"],
      },
    );

    await user.click(screen.getByRole("button", { name: "그룹 옵션" }));

    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
  });

  it("returns to posts when the mobile group name is selected", async () => {
    const { user } = renderRoute(DetailHarness, {
      path: "/groups/:slug",
      initialEntries: ["/groups/test-group?tab=members"],
    });

    await user.click(screen.getByRole("button", { name: "테스트 그룹" }));

    expect(screen.getByTestId("location-search")).toHaveTextContent("");
    expect(screen.getByText("아직 게시물이 없습니다")).toBeInTheDocument();
  });

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
    expect(
      screen.queryByRole("button", { name: "열기" }),
    ).not.toBeInTheDocument();
  });

  it("uses the detail join label and prevents teachers from joining", () => {
    const joinableGroup = {
      ...baseGroup,
      membership_state: "none" as const,
      member_role: null,
    };
    const { unmount } = renderRoute(
      () => <DetailHarness group={joinableGroup} />,
      {
        path: "/groups/:slug",
        initialEntries: ["/groups/test-group"],
      },
    );

    expect(
      screen.getByRole("button", { name: "그룹 가입" }),
    ).toBeInTheDocument();
    unmount();

    renderRoute(() => <DetailHarness group={joinableGroup} isTeacher />, {
      path: "/groups/:slug",
      initialEntries: ["/groups/test-group"],
    });

    expect(
      screen.queryByRole("button", { name: "그룹 가입" }),
    ).not.toBeInTheDocument();
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
      screen.getByText("멤버 명부를 불러오는 중입니다."),
    ).toBeInTheDocument();
  });

  it("shows settings and the member directory to managers", () => {
    const { unmount } = renderRoute(DetailHarness, {
      path: "/groups/:slug",
      initialEntries: ["/groups/test-group?tab=members"],
    });

    expect(
      screen.queryByRole("button", { name: "그룹 설정" }),
    ).not.toBeInTheDocument();
    unmount();

    const manager = {
      ...baseGroup,
      member_role: "manager" as const,
    };

    renderRoute(() => <DetailHarness group={manager} />, {
      path: "/groups/:slug",
      initialEntries: ["/groups/test-group?tab=members"],
    });

    expect(screen.getByRole("button", { name: "멤버" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "그룹 설정" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("멤버 명부를 불러오는 중입니다."),
    ).toBeInTheDocument();
  });
});
