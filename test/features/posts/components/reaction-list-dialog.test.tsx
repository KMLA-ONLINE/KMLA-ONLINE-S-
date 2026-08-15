import { describe, expect, it, vi } from "vitest";

import { ReactionListDialog } from "~/features/posts/components/reaction-list-dialog";
import type { PostReactor } from "~/features/posts/model/types";
import { renderRoute, screen, within } from "../../../router";

const identified = (over: Partial<PostReactor> = {}): PostReactor => ({
  reaction: "like",
  reactor_pub_id: "hanbyeol-25",
  reactor_name: "이한별",
  reactor_avatar_path: null,
  reacted_at: "2026-08-13T02:00:00Z",
  anonymous_count: null,
  ...over,
});

function renderDialog(reactors: PostReactor[], loading = false) {
  return renderRoute(() => (
    <ReactionListDialog
      open
      onOpenChange={vi.fn()}
      reactors={reactors}
      loading={loading}
    />
  ));
}

describe("ReactionListDialog", () => {
  it("links an identified reactor to their profile", () => {
    renderDialog([identified()]);

    expect(screen.getByRole("link", { name: /이한별/ })).toHaveAttribute(
      "href",
      "/profile/hanbyeol-25",
    );
  });

  it("folds anonymous reactions into a headcount that still counts", () => {
    renderDialog([
      identified(),
      {
        reaction: "love",
        reactor_pub_id: null,
        reactor_name: null,
        reactor_avatar_path: null,
        reacted_at: null,
        anonymous_count: 4,
      },
    ]);

    // 개인은 드러내지 않지만 총계에는 들어간다(기능 명세 §10.3).
    expect(screen.getByText("익명 4명")).toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(
      within(screen.getByRole("tablist")).getByRole("tab", { name: "전체 5" }),
    ).toBeInTheDocument();
  });

  it("filters the list to one reaction kind", async () => {
    const { user } = renderDialog([
      identified(),
      identified({
        reaction: "love",
        reactor_pub_id: "saebyeok-24",
        reactor_name: "박새벽",
      }),
    ]);

    await user.click(screen.getByRole("tab", { name: /하트/ }));

    expect(screen.getByText("박새벽")).toBeInTheDocument();
    expect(screen.queryByText("이한별")).not.toBeInTheDocument();
  });

  it("names a reactor whose profile is gone", () => {
    // 반응은 총계에 남으므로 줄도 남긴다. 이름만 없다.
    renderDialog([identified({ reactor_pub_id: null, reactor_name: null })]);

    expect(screen.getByText("탈퇴한 사용자")).toBeInTheDocument();
  });

  it("waits for the list instead of claiming there are none", () => {
    renderDialog([], true);
    expect(screen.queryByText("아직 반응이 없습니다")).not.toBeInTheDocument();
  });
});
