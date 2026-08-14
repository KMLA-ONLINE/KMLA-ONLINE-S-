import { describe, expect, it, vi } from "vitest";

import { GroupPostActionBar } from "~/features/posts/components/group-post-action-bar";
import { renderRoute, screen } from "../../../router";

describe("GroupPostActionBar", () => {
  it("hides the comment count while nobody has commented", () => {
    renderRoute(() => (
      <GroupPostActionBar
        sharePath="/groups/group/posts/post-id"
        shareTitle="제목"
        commentCount={0}
        commentTo="/groups/group/posts/post-id"
      />
    ));

    expect(
      screen.getByRole("link", { name: "댓글 0개" }),
    ).not.toHaveTextContent("0");
  });

  it("keeps the reaction slot disabled until that feature lands", () => {
    renderRoute(() => (
      <GroupPostActionBar
        sharePath="/groups/group/posts/post-id"
        shareTitle="제목"
        commentCount={0}
      />
    ));

    expect(
      screen.getByRole("button", { name: "반응 (준비 중)" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "공유" })).toBeEnabled();
  });

  it("sends the feed card to the post detail with its comment count", () => {
    renderRoute(() => (
      <GroupPostActionBar
        sharePath="/groups/group/posts/post-id"
        shareTitle="제목"
        commentCount={7}
        commentTo="/groups/group/posts/post-id"
      />
    ));

    const link = screen.getByRole("link", { name: "댓글 7개" });
    expect(link).toHaveAttribute("href", "/groups/group/posts/post-id");
    expect(link).toHaveTextContent("7");
  });

  it("sends the detail view to its own composer", async () => {
    const onComment = vi.fn();
    const { user } = renderRoute(() => (
      <GroupPostActionBar
        sharePath="/groups/group/posts/post-id"
        shareTitle="제목"
        commentCount={2}
        onComment={onComment}
      />
    ));

    await user.click(screen.getByRole("button", { name: "댓글 2개" }));
    expect(onComment).toHaveBeenCalled();
  });
});
