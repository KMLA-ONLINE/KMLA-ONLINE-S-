import { screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GroupFeaturedPosts } from "~/features/posts/components/group/group-featured-posts";
import { writeGroupSectionCollapsed } from "~/features/posts/model/section-collapse";
import { groupPost } from "../../group-post-fixture";
import { renderRoute } from "../../../../router";

const handlers = {
  onPin: vi.fn(),
  onFeature: vi.fn(),
  onMoveFeaturedFront: vi.fn(),
  onDelete: vi.fn(),
};

function renderFeatured(posts = [groupPost()]) {
  return renderRoute(() => (
    <GroupFeaturedPosts
      groupId="group-id"
      slug="group"
      posts={posts}
      {...handlers}
    />
  ));
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe("GroupFeaturedPosts", () => {
  it("renders nothing without featured posts", () => {
    renderFeatured([]);
    expect(
      screen.queryByRole("region", { name: "대표 게시물" }),
    ).not.toBeInTheDocument();
  });

  it("lists featured cards in the order given with their titles linked", () => {
    renderFeatured([
      groupPost({ post_id: "first", title: "바베큐 달력", is_featured: true }),
      groupPost({ post_id: "second", title: "건의함", is_featured: true }),
    ]);
    const region = screen.getByRole("region", { name: "대표 게시물" });
    const links = within(region).getAllByRole("link", {
      name: /바베큐 달력|건의함/,
    });
    expect(links.map((link) => link.textContent)).toEqual([
      "바베큐 달력",
      "건의함",
    ]);
    expect(links[0]).toHaveAttribute("href", "/groups/group/posts/first");
  });

  it("explains what featured posts are", () => {
    renderFeatured();
    expect(
      screen.getByRole("button", { name: "대표 게시물 안내" }),
    ).toBeInTheDocument();
  });

  it("collapses the cards and remembers it for this group on this device", async () => {
    const user = userEvent.setup();
    renderFeatured([groupPost({ title: "바베큐 달력", is_featured: true })]);
    const toggle = screen.getByRole("button", { name: "대표 게시물 접기" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    await user.click(toggle);

    expect(screen.queryByText("바베큐 달력")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "대표 게시물 펼치기" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(
      JSON.parse(
        window.localStorage.getItem("kmla-online:group-sections:v1") ?? "{}",
      ),
    ).toEqual({ "group-id": { featured: true } });
  });

  it("starts collapsed when this device collapsed it before", () => {
    writeGroupSectionCollapsed("group-id", "featured", true);
    renderFeatured([groupPost({ title: "바베큐 달력", is_featured: true })]);
    expect(screen.queryByText("바베큐 달력")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "대표 게시물 펼치기" }),
    ).toBeInTheDocument();
  });
});
