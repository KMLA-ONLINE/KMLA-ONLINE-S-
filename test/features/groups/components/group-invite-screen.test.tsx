import { afterEach, describe, expect, it } from "vitest";

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
  allowed_profile_types: ["student", "alumni"],
  profile_type_allowed: true,
};

describe("GroupInviteScreen", () => {
  it("tells the visitor what group they are being let into", () => {
    renderRoute(() => <GroupInviteScreen preview={preview} />);

    expect(screen.getByText("29기 수학 탐구")).toBeVisible();
    expect(screen.getByText("12명")).toBeVisible();
    expect(
      screen.getByText(
        "가입하면 이 그룹의 게시물과 멤버 목록을 볼 수 있습니다.",
      ),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "가입하기" })).toBeVisible();
  });

  it("explains a link that no longer works instead of a bare error", () => {
    // 만료와 취소를 구분해 봐야 받는 사람이 할 수 있는 일은 같다 — 새 링크를 받는 것뿐이다.
    renderRoute(() => <GroupInviteScreen preview={null} />);

    expect(screen.getByText("사용할 수 없는 초대 링크입니다")).toBeVisible();
    expect(
      screen.getByText(
        "만료되었거나 더 이상 사용할 수 없는 링크입니다. 초대한 사람에게 새 링크를 요청해 주세요.",
      ),
    ).toBeVisible();
    // Button이 `render` prop으로 Link를 감싸면 anchor에 role="button"이 붙는다.
    expect(
      screen.getByRole("button", { name: "그룹 목록으로" }),
    ).toHaveAttribute("href", "/groups");
    expect(
      screen.queryByRole("button", { name: "가입하기" }),
    ).not.toBeInTheDocument();
  });

  it("hides group information from a profile type the link does not allow", () => {
    renderRoute(() => (
      <GroupInviteScreen
        preview={{ ...preview, profile_type_allowed: false }}
      />
    ));

    expect(screen.getByText("가입할 수 없는 초대 링크입니다")).toBeVisible();
    expect(
      screen.getByText("이 링크는 재학생·졸업생만 가입할 수 있습니다."),
    ).toBeVisible();
    expect(screen.queryByText(preview.name)).not.toBeInTheDocument();
    expect(screen.queryByText(preview.description)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "가입하기" }),
    ).not.toBeInTheDocument();
  });

  it("sends an existing member to the group rather than joining again", () => {
    renderRoute(() => (
      <GroupInviteScreen
        preview={{
          ...preview,
          already_member: true,
          profile_type_allowed: false,
        }}
      />
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

describe("GroupInviteScreen in English", () => {
  afterEach(() => window.localStorage.clear());

  it("renders the invite preview in English", () => {
    window.localStorage.setItem("kmla-online:language:v1", "en");
    renderRoute(() => <GroupInviteScreen preview={preview} />);

    expect(screen.getByText("Members")).toBeVisible();
    expect(screen.getByText("12 people")).toBeVisible();
    expect(screen.getByText("Join policy")).toBeVisible();
    expect(screen.getByText("Invite only")).toBeVisible();
    expect(screen.getByRole("button", { name: "Join" })).toBeVisible();
    expect(
      screen.getByText(
        "Once you join, you can see this group's posts and member list.",
      ),
    ).toBeVisible();
  });

  it("explains an unusable link in English", () => {
    window.localStorage.setItem("kmla-online:language:v1", "en");
    renderRoute(() => <GroupInviteScreen preview={null} />);

    expect(screen.getByText("This invite link can't be used")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Back to groups" }),
    ).toBeVisible();
  });
});
