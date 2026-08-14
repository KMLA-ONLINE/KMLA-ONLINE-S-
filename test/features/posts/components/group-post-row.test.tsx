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

  it("shows the category badge and the edited mark only when they apply", () => {
    const { unmount } = renderRow();
    expect(screen.queryByText("공지")).not.toBeInTheDocument();
    expect(screen.queryByText("수정됨")).not.toBeInTheDocument();
    unmount();

    renderRow(
      groupPost({ category_name: "공지", edited_at: "2026-08-13T01:00:00Z" }),
    );
    expect(screen.getByText("공지")).toBeInTheDocument();
    expect(screen.getByText("수정됨")).toBeInTheDocument();
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
