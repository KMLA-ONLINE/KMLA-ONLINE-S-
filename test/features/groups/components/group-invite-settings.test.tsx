import { describe, expect, it } from "vitest";

import { InviteSettings } from "~/features/groups/components/group-invite-settings";
import type { GroupDetail, GroupInvite } from "~/features/groups/model/types";
import { renderRoute, screen } from "../../../router";

const group: GroupDetail = {
  id: "group-1",
  group_id: "group-1",
  slug: "g-8f2a1c4e6b9d7a3c5e10",
  name: "테스트 그룹",
  description: "설명",
  kind: "unofficial",
  join_policy: "invite_only",
  identity_policy: "identified",
  posting_policy: "members",
  icon_path: null,
  cover_path: null,
  member_count: 4,
  membership_state: "member",
  member_role: "owner",
  requested_at: null,
  pinned_at: null,
};

const invite: GroupInvite = {
  token: "0123456789abcdef0123456789abcdef",
  expires_at: "2026-09-01T09:00:00Z",
};

describe("InviteSettings", () => {
  it("opens with a one-day link and nothing to revoke yet", () => {
    renderRoute(() => <InviteSettings group={group} invite={null} />);

    expect(screen.getByRole("combobox", { name: "유효 기간" })).toHaveValue(
      "24",
    );
    expect(
      screen.getByRole("button", { name: "초대 링크 만들기" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "링크 끊기" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "초대 링크" }),
    ).not.toBeInTheDocument();
  });

  it("shows the address to hand out and when it dies", () => {
    renderRoute(() => <InviteSettings group={group} invite={invite} />);

    expect(screen.getByRole("textbox", { name: "초대 링크" })).toHaveValue(
      `${window.location.origin}/invite/${invite.token}`,
    );
    expect(screen.getByText(/만료됩니다/)).toBeVisible();
  });

  it("warns that a new link cuts off everyone holding the old one", async () => {
    // 재발급이 곧 이전 링크의 무효화라서, 링크를 이미 뿌린 뒤에는 되돌릴 수 없다.
    const { user } = renderRoute(() => (
      <InviteSettings group={group} invite={invite} />
    ));

    await user.click(screen.getByRole("button", { name: "새 링크 만들기" }));

    expect(screen.getByRole("dialog")).toHaveTextContent(
      "지금 링크는 즉시 끊깁니다",
    );
  });

  it("confirms before cutting the link off", async () => {
    const { user } = renderRoute(() => (
      <InviteSettings group={group} invite={invite} />
    ));

    await user.click(screen.getByRole("button", { name: "링크 끊기" }));

    expect(screen.getByRole("dialog")).toHaveTextContent(
      "이미 가입한 멤버는 그대로 남습니다",
    );
  });

  it("keeps invite links out of a manager's hands", () => {
    // 사람을 들이는 것은 운영진의 일이다. 서버도 42501로 막는다.
    renderRoute(() => (
      <InviteSettings
        group={{ ...group, member_role: "manager" }}
        invite={null}
      />
    ));

    expect(
      screen.queryByRole("button", { name: "초대 링크 만들기" }),
    ).not.toBeInTheDocument();
  });

  it("never offers an invite link for an official group", () => {
    // 승인된 재학생이 트리거로 자동 가입하므로 초대할 사람이 없다.
    renderRoute(() => (
      <InviteSettings group={{ ...group, kind: "official" }} invite={null} />
    ));

    expect(
      screen.queryByRole("button", { name: "초대 링크 만들기" }),
    ).not.toBeInTheDocument();
  });
});
