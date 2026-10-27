import { screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GroupFeaturedPosts } from "~/features/posts/components/group/group-featured-posts";
import { groupPost } from "../../group-post-fixture";
import { renderRoute } from "../../../../router";

const handlers = {
  onPin: vi.fn(),
  onFeature: vi.fn(),
  onDelete: vi.fn(),
};

function renderFeatured(posts = [groupPost()]) {
  return renderRoute(() => (
    <GroupFeaturedPosts slug="group" posts={posts} {...handlers} />
  ));
}

beforeEach(() => vi.clearAllMocks());

describe("GroupFeaturedPosts", () => {
  it("renders nothing without featured posts", () => {
    renderFeatured([]);
    expect(
      screen.queryByRole("region", { name: "대표 게시물" }),
    ).not.toBeInTheDocument();
  });

  // 그룹에 들어오면 최근 글이 먼저 보여야 한다. 대표 글은 오래 두는 글이라 펼쳐 볼 때만 보인다.
  it("starts collapsed with only the header and explanation", () => {
    renderFeatured([groupPost({ title: "바베큐 달력", is_featured: true })]);
    expect(screen.getByRole("region", { name: "대표 게시물" })).toBeVisible();
    expect(screen.queryByText("바베큐 달력")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "대표 게시물 안내" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "대표 게시물 펼치기" }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("expands to the cards in the order given with their titles linked", async () => {
    const user = userEvent.setup();
    renderFeatured([
      groupPost({ post_id: "first", title: "바베큐 달력", is_featured: true }),
      groupPost({ post_id: "second", title: "건의함", is_featured: true }),
    ]);
    await user.click(
      screen.getByRole("button", { name: "대표 게시물 펼치기" }),
    );

    const region = screen.getByRole("region", { name: "대표 게시물" });
    const links = within(region).getAllByRole("link", {
      name: /바베큐 달력|건의함/,
    });
    expect(links.map((link) => link.textContent)).toEqual([
      "바베큐 달력",
      "건의함",
    ]);
    expect(links[0]).toHaveAttribute("href", "/groups/group/posts/first");

    await user.click(screen.getByRole("button", { name: "대표 게시물 접기" }));
    expect(screen.queryByText("바베큐 달력")).not.toBeInTheDocument();
  });
});
