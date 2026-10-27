import { screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GroupPostFeed } from "~/features/posts/components/group/group-post-feed";
import type { PostViewMode } from "~/features/posts/model/types";
import { writeGroupSectionCollapsed } from "~/features/posts/model/section-collapse";
import { groupPost } from "../../group-post-fixture";
import { renderRoute } from "../../../../router";

const posts = [
  groupPost({ post_id: "pinned-1", title: "고정 하나", is_pinned: true }),
  groupPost({ post_id: "pinned-2", title: "고정 둘", is_pinned: true }),
  groupPost({ post_id: "plain", title: "일반 글" }),
];

function renderFeed(viewMode: PostViewMode = "card") {
  return renderRoute(() => (
    <GroupPostFeed
      groupId="group-id"
      posts={posts}
      slug="group"
      viewMode={viewMode}
      onPin={vi.fn()}
      onFeature={vi.fn()}
      onMoveFeaturedFront={vi.fn()}
      onDelete={vi.fn()}
    />
  ));
}

beforeEach(() => window.localStorage.clear());

describe("GroupPostFeed pinned section", () => {
  it.each<PostViewMode>(["card", "list"])(
    "groups pinned posts under a counted header in %s view",
    (viewMode) => {
      renderFeed(viewMode);
      expect(
        screen.getByRole("region", { name: "고정된 게시물" }),
      ).toHaveTextContent("고정된 게시물 2개");
      expect(screen.getByText("고정 하나")).toBeInTheDocument();
      expect(screen.getByText("일반 글")).toBeInTheDocument();
    },
  );

  it("hides only the pinned posts when collapsed and remembers it", async () => {
    const user = userEvent.setup();
    renderFeed();
    await user.click(
      screen.getByRole("button", { name: "고정된 게시물 접기" }),
    );

    expect(screen.queryByText("고정 하나")).not.toBeInTheDocument();
    expect(screen.queryByText("고정 둘")).not.toBeInTheDocument();
    expect(screen.getByText("일반 글")).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "고정된 게시물" }),
    ).toHaveTextContent("고정된 게시물 2개");
    expect(
      JSON.parse(
        window.localStorage.getItem("kmla-online:group-sections:v1") ?? "{}",
      ),
    ).toEqual({ "group-id": { pinned: true } });
  });

  it("starts collapsed when this device collapsed it before", () => {
    writeGroupSectionCollapsed("group-id", "pinned", true);
    renderFeed("list");
    expect(screen.queryByText("고정 하나")).not.toBeInTheDocument();
    expect(screen.getByText("일반 글")).toBeInTheDocument();
  });

  it("shows no pinned section without pinned posts", () => {
    renderRoute(() => (
      <GroupPostFeed
        groupId="group-id"
        posts={[groupPost({ title: "일반 글" })]}
        slug="group"
        viewMode="card"
        onPin={vi.fn()}
        onFeature={vi.fn()}
        onMoveFeaturedFront={vi.fn()}
        onDelete={vi.fn()}
      />
    ));
    expect(
      screen.queryByRole("region", { name: "고정된 게시물" }),
    ).not.toBeInTheDocument();
  });
});
