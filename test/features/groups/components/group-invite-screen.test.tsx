import { describe, expect, it } from "vitest";

import { GroupInviteScreen } from "~/features/groups/components/group-invite-screen";
import type { GroupInvitePreview } from "~/features/groups/model/types";
import { renderRoute, screen } from "../../../router";

const preview: GroupInvitePreview = {
  group_id: "group-1",
  slug: "g-8f2a1c4e6b9d7a3c5e10",
  name: "29기 수학 탐구",
  description: "함께 문제를 풀고 탐구 주제를 나눕니다.",
  join_policy: "invite_only",
  identity_policy: "optional_anonymous",
  posting_policy: "members",
  member_count: 12,
  expires_at: "2026-09-01T09:00:00Z",
  already_member: false,
};

describe("GroupInviteScreen", () => {
  it("tells the visitor what group they are being let into", () => {
    renderRoute(() => <GroupInviteScreen preview={preview} />);

    expect(screen.getByText("29기 수학 탐구")).toBeVisible();
    expect(screen.getByText("12명")).toBeVisible();
    expect(screen.getByRole("button", { name: "가입하기" })).toBeVisible();
  });

  it("explains a link that no longer works instead of a bare error", () => {
    // 만료와 취소를 구분해 봐야 받는 사람이 할 수 있는 일은 같다 — 새 링크를 받는 것뿐이다.
    renderRoute(() => <GroupInviteScreen preview={null} />);

    expect(screen.getByText("쓸 수 없는 초대 링크입니다")).toBeVisible();
    // Button이 `render` prop으로 Link를 감싸면 anchor에 role="button"이 붙는다.
    expect(
      screen.getByRole("button", { name: "그룹 목록으로" }),
    ).toHaveAttribute("href", "/groups");
    expect(
      screen.queryByRole("button", { name: "가입하기" }),
    ).not.toBeInTheDocument();
  });

  it("sends an existing member to the group rather than joining again", () => {
    renderRoute(() => (
      <GroupInviteScreen preview={{ ...preview, already_member: true }} />
    ));

    expect(screen.getByRole("button", { name: "그룹 열기" })).toHaveAttribute(
      "href",
      "/groups/g-8f2a1c4e6b9d7a3c5e10",
    );
    expect(
      screen.queryByRole("button", { name: "가입하기" }),
    ).not.toBeInTheDocument();
  });
});
