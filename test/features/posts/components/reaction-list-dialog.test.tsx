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

  it("counts every reactor as an individual row", () => {
    renderDialog([
      identified(),
      identified({
        reaction: "love",
        reactor_pub_id: "saebyeok-24",
        reactor_name: "박새벽",
      }),
    ]);

    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(
      within(screen.getByRole("tablist")).getByRole("tab", { name: "전체 2" }),
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

  it("waits for the list instead of claiming there are none", () => {
    renderDialog([], true);
    expect(screen.queryByText("아직 반응이 없습니다")).not.toBeInTheDocument();
  });
});
