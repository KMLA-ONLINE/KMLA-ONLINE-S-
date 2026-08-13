import { describe, expect, it } from "vitest";
import { useLocation } from "react-router";

import { GroupMembersPanel } from "~/features/groups/components/group-members-panel";
import type { GroupMember } from "~/features/groups/model/types";
import { renderRoute, screen } from "../../../router";

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
        identityPolicy="identified"
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
        identityPolicy="identified"
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

  it("renders always-anonymous rows with cohort only", () => {
    renderRoute(() => (
      <GroupMembersPanel
        groupId="group-1"
        identityPolicy="always_anonymous"
        viewerRole="member"
        initialPage={{
          members: [{ ...member, name: null, pub_id: null }],
          nextCursor: null,
        }}
        memberCount={1}
      />
    ));

    expect(screen.getByText("30기")).toBeInTheDocument();
    expect(screen.queryByText("홍길동")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByAltText(/프로필 사진/)).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "기수 검색" })).toBeVisible();
  });

  it("searches only after Enter with at least two characters", async () => {
    const { user } = renderRoute(() => <SearchTestScreen />);
    const search = screen.getByRole("textbox", { name: "이름 또는 기수 검색" });

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

  it("shows role controls and anonymized requests to an owner", async () => {
    const { user } = renderRoute(() => (
      <GroupMembersPanel
        groupId="group-1"
        identityPolicy="always_anonymous"
        viewerRole="owner"
        initialPage={{
          members: [{ ...member, role: "admin", name: null, pub_id: null }],
          nextCursor: null,
        }}
        memberCount={1}
        joinRequests={[
          {
            request_id: "request-1",
            requested_at: "2026-01-02T00:00:00Z",
            cohort: 31,
            pub_id: null,
            name: null,
            avatar_path: null,
          },
        ]}
      />
    ));

    expect(screen.getByText("31기")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "승인" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "30기 역할 관리" }));
    await user.click(await screen.findByText("소유권 이전"));
    expect(screen.getByRole("dialog")).toHaveTextContent("그룹 소유권 이전");
  });
});
