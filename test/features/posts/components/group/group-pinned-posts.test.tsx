import { screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GroupPinnedPosts } from "~/features/posts/components/group/group-pinned-posts";
import type { GroupPost } from "~/features/posts/model/types";
import { groupPost } from "../../group-post-fixture";
import { renderRoute } from "../../../../router";

const handlers = {
  onPin: vi.fn(),
  onDelete: vi.fn(),
};

function StatefulPinned({ posts }: { posts: GroupPost[] }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <GroupPinnedPosts
      slug="group"
      posts={posts}
      collapsed={collapsed}
      onCollapsedChange={setCollapsed}
      {...handlers}
    />
  );
}

function renderPinned(posts = [groupPost()]) {
  return renderRoute(() => <StatefulPinned posts={posts} />);
}

beforeEach(() => vi.clearAllMocks());

describe("GroupPinnedPosts", () => {
  it("renders nothing without pinned posts", () => {
    renderPinned([]);
    expect(
      screen.queryByRole("region", { name: "고정된 게시물" }),
    ).not.toBeInTheDocument();
  });

  // 조용히 사라지면 운영진은 고정이 풀린 줄 알고 다시 고정하거나 버그로 신고한다.
  it("shows a retryable notice when the list failed", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    renderRoute(() => (
      <GroupPinnedPosts
        slug="group"
        posts={[]}
        failed
        onRetry={onRetry}
        collapsed={false}
        onCollapsedChange={() => undefined}
        {...handlers}
      />
    ));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "고정된 게시물을 불러오지 못했습니다.",
    );
    await user.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(onRetry).toHaveBeenCalled();
  });

  // 목록 패널은 삭제 뒤 다시 마운트된다. 접힘을 부모가 들면 그 뒤에도 접힌 채다.
  it("lets the parent own the collapse state", async () => {
    const user = userEvent.setup();
    const onCollapsedChange = vi.fn();
    renderRoute(() => (
      <GroupPinnedPosts
        slug="group"
        posts={[groupPost({ title: "바베큐 달력", is_pinned: true })]}
        collapsed={false}
        onCollapsedChange={onCollapsedChange}
        {...handlers}
      />
    ));
    expect(screen.getByText("바베큐 달력")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "고정된 게시물 접기" }),
    );
    expect(onCollapsedChange).toHaveBeenCalledWith(true);
    // 부모가 값을 바꾸지 않았으니 그대로 펼쳐져 있다.
    expect(screen.getByText("바베큐 달력")).toBeInTheDocument();
  });

  it("shows the cards in the order given with their titles linked", async () => {
    const user = userEvent.setup();
    renderPinned([
      groupPost({ post_id: "first", title: "바베큐 달력", is_pinned: true }),
      groupPost({ post_id: "second", title: "건의함", is_pinned: true }),
    ]);

    const region = screen.getByRole("region", { name: "고정된 게시물" });
    const links = within(region).getAllByRole("link", {
      name: /바베큐 달력|건의함/,
    });
    expect(links.map((link) => link.textContent)).toEqual([
      "바베큐 달력",
      "건의함",
    ]);
    expect(links[0]).toHaveAttribute("href", "/groups/group/posts/first");

    await user.click(
      screen.getByRole("button", { name: "고정된 게시물 접기" }),
    );
    expect(screen.queryByText("바베큐 달력")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "고정된 게시물 펼치기" }),
    ).toHaveAttribute("aria-expanded", "false");
  });
});
