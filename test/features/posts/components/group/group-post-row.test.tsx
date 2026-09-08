import { screen } from "@testing-library/react";
import { useLocation } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { GroupPostRow } from "~/features/posts/components/group/group-post-row";
import { isFromGroup } from "~/features/posts/model/navigation";
import { groupPost } from "../../group-post-fixture";
import { renderRoute } from "../../../../router";

/** state는 DOM에 남지 않으므로 실제로 눌러서 도착지가 무엇을 받았는지 본다. */
function Landing() {
  return <p>{isFromGroup(useLocation().state) ? "표식 있음" : "표식 없음"}</p>;
}

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

  /**
   * 상세는 이 표식으로 "◯◯ 그룹으로 이동" 링크를 감춘다(`model/navigation.ts`). 빠뜨리면
   * 그룹에서 연 게시물에도 링크가 한 번 더 붙는다.
   */
  it("marks the post as opened from inside the group", async () => {
    const onVisit = vi.fn();
    const { user } = renderRoute(
      () => (
        <GroupPostRow
          post={groupPost()}
          slug="group"
          isVisited={false}
          onVisit={onVisit}
        />
      ),
      {
        routes: [{ path: "/groups/group/posts/post-id", Component: Landing }],
      },
    );

    await user.click(screen.getByRole("link"));
    expect(await screen.findByText("표식 있음")).toBeVisible();
  });

  it("shows the category badge only when the post has one", () => {
    const { unmount } = renderRow();
    expect(screen.queryByText("공지")).not.toBeInTheDocument();
    unmount();

    renderRow(groupPost({ category_name: "공지" }));
    expect(screen.getByText("공지")).toBeInTheDocument();
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
