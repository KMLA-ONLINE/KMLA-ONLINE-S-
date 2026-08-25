import { describe, expect, it } from "vitest";
import { useLocation } from "react-router";

import { GroupMembersPanel } from "~/features/groups/components/group-members-panel";
import type { GroupMember } from "~/features/groups/model/types";
import { renderRoute, screen, within } from "../../../router";

const member: GroupMember = {
  membership_id: "membership-1",
  role: "member",
  joined_at: "2026-01-01T00:00:00Z",
  cohort: 30,
  pub_id: "profile-public-id",
  name: "홍길동",
  avatar_path: null,
};

function SearchTestScreen() {
  const location = useLocation();
  return (
    <>
      <GroupMembersPanel
        groupId="group-1"
        viewerRole="member"
        initialPage={{ members: [member], nextCursor: null }}
        memberCount={1}
      />
      <output aria-label="현재 검색">{location.search}</output>
    </>
  );
}

describe("GroupMembersPanel", () => {
  it("links identified members to their profile", () => {
    renderRoute(() => (
      <GroupMembersPanel
        groupId="group-1"
        viewerRole="member"
        initialPage={{ members: [member], nextCursor: null }}
        memberCount={1}
      />
    ));

    expect(screen.getByRole("link", { name: /홍길동/ })).toHaveAttribute(
      "href",
      "/profile/profile-public-id",
    );
    expect(screen.getByText("30기")).toBeInTheDocument();
  });

  it("searches only after Enter with at least two characters", async () => {
    const { user } = renderRoute(() => <SearchTestScreen />);
    const search = screen.getByRole("searchbox", {
      name: "이름 또는 기수 검색",
    });

    await user.type(search, "홍");
    expect(screen.getByText("홍길동")).toBeVisible();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("alert")).toHaveTextContent("2자 이상");

    await user.type(search, "길");
    await user.click(screen.getByRole("button", { name: "멤버 검색" }));
    expect(screen.getByRole("status", { name: "현재 검색" })).toHaveTextContent(
      "memberQuery=%ED%99%8D%EA%B8%B8",
    );
  });

  it("shows identified join requests and role controls to an owner", async () => {
    const { user } = renderRoute(() => (
      <GroupMembersPanel
        groupId="group-1"
        viewerRole="owner"
        initialPage={{
          members: [{ ...member, role: "admin" }],
          nextCursor: null,
        }}
        memberCount={1}
        joinRequests={[
          {
            request_id: "request-1",
            requested_at: "2026-01-02T00:00:00Z",
            cohort: 31,
            pub_id: "joiner-public-id",
            name: "김가입",
            avatar_path: null,
          },
        ]}
      />
    ));

    expect(screen.getByRole("link", { name: "김가입" })).toHaveAttribute(
      "href",
      "/profile/joiner-public-id",
    );
    expect(screen.getByRole("button", { name: "승인" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "홍길동 역할 관리" }));
    await user.click(await screen.findByText("소유권 이전"));
    expect(screen.getByRole("dialog")).toHaveTextContent("그룹 소유권 이전");
  });

  it("confirms a role change before submitting it", async () => {
    // 드롭다운 항목은 서로 붙어 있어서 잘못 누르기 쉽다.
    const { user } = renderRoute(() => (
      <GroupMembersPanel
        groupId="group-1"
        viewerRole="owner"
        initialPage={{ members: [member], nextCursor: null }}
        memberCount={1}
      />
    ));

    await user.click(screen.getByRole("button", { name: "홍길동 역할 관리" }));
    await user.click(await screen.findByRole("menuitem", { name: "관리자" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("홍길동님을 멤버에서 관리자로 바꿀까요?");
    // 승격 뒤에는 소유자 말고 아무도 이 사람의 역할을 건드릴 수 없다.
    expect(dialog).toHaveTextContent("소유자만 바꿀 수 있습니다");

    await user.click(within(dialog).getByRole("button", { name: "취소" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps one administrator out of another administrator's reach", () => {
    // 관리자끼리 서로 강등할 수 있으면 둘이 번갈아 내리는 상황을 그룹이 스스로 정리하지 못한다.
    renderRoute(() => (
      <GroupMembersPanel
        groupId="group-1"
        viewerRole="admin"
        initialPage={{
          members: [{ ...member, role: "admin" }],
          nextCursor: null,
        }}
        memberCount={1}
      />
    ));

    expect(
      screen.queryByRole("button", { name: /역할 관리/ }),
    ).not.toBeInTheDocument();
  });

  it("lets an administrator move managers but not appoint administrators", async () => {
    // 늘리는 것은 아무나, 줄이는 것은 소유자만 할 수 있으면 관리자 수가 한 방향으로만 늘어난다.
    const { user } = renderRoute(() => (
      <GroupMembersPanel
        groupId="group-1"
        viewerRole="admin"
        initialPage={{
          members: [{ ...member, role: "manager" }],
          nextCursor: null,
        }}
        memberCount={1}
      />
    ));

    await user.click(screen.getByRole("button", { name: /역할 관리/ }));

    expect(await screen.findByRole("menuitem", { name: "멤버" })).toBeVisible();
    expect(
      screen.queryByRole("menuitem", { name: "관리자" }),
    ).not.toBeInTheDocument();
  });

  it("hides role controls from a manager", () => {
    renderRoute(() => (
      <GroupMembersPanel
        groupId="group-1"
        viewerRole="manager"
        initialPage={{ members: [member], nextCursor: null }}
        memberCount={1}
      />
    ));

    expect(
      screen.queryByRole("button", { name: /역할 관리/ }),
    ).not.toBeInTheDocument();
  });
});
