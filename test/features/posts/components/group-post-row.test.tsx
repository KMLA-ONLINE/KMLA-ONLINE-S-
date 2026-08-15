import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { GroupPostRow } from "~/features/posts/components/group-post-row";
import { groupPost } from "../group-post-fixture";
import { renderRoute } from "../../../router";

function renderRow(post = groupPost(), isVisited = false) {
  const onVisit = vi.fn();
  const view = renderRoute(() => (
    <GroupPostRow
      post={post}
      slug="group"
      isVisited={isVisited}
      onVisit={onVisit}
    />
  ));
  return { ...view, onVisit };
}

describe("GroupPostRow", () => {
  it("links to the post and reports the visit", async () => {
    const { user, onVisit } = renderRow();

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/groups/group/posts/post-id");

    await user.click(link);
    expect(onVisit).toHaveBeenCalledOnce();
  });

  it("shows the category badge only when the post has one", () => {
    const { unmount } = renderRow();
    expect(screen.queryByText("공지")).not.toBeInTheDocument();
    unmount();

    renderRow(groupPost({ category_name: "공지" }));
    expect(screen.getByText("공지")).toBeInTheDocument();
  });

  it("does not mark an edited post", () => {
    // 게시물에는 수정 표시를 두지 않는다. 댓글에만 남는다.
    renderRow(groupPost({ edited_at: "2026-08-13T01:00:00Z" }));
    expect(screen.queryByText("수정됨")).not.toBeInTheDocument();
  });

  it("shows the real comment and reaction counts", () => {
    renderRow(
      groupPost({
        comment_count: 12,
        reaction_count: 4,
        top_reactions: ["like", "love"],
      }),
    );

    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    // 행 전체가 하나의 링크다. 반응 그래픽이 붙어도 그 안에 누를 것을 더 만들지 않는다.
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("marks pinned posts", () => {
    renderRow(groupPost({ is_pinned: true }));
    expect(screen.getByLabelText("고정됨")).toBeInTheDocument();
  });

  it("dims a visited row", () => {
    renderRow(groupPost(), true);
    expect(screen.getByRole("link")).toHaveClass("bg-muted/45");
  });
});
