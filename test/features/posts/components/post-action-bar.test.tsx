import { beforeEach, describe, expect, it, vi } from "vitest";

const { setPostReaction, clearPostReaction, listPostReactors } = vi.hoisted(
  () => ({
    setPostReaction: vi.fn(),
    clearPostReaction: vi.fn(),
    listPostReactors: vi.fn(),
  }),
);

vi.mock("~/features/posts/data/mutations", () => ({
  setPostReaction,
  clearPostReaction,
}));
vi.mock("~/features/posts/data/queries", () => ({ listPostReactors }));

import { PostActionBar } from "~/features/posts/components/post-action-bar";
import { renderRoute, screen } from "../../../router";

beforeEach(() => {
  setPostReaction.mockResolvedValue({
    reaction_count: 4,
    top_reactions: ["like"],
    my_reaction: "like",
  });
  clearPostReaction.mockResolvedValue({
    reaction_count: 0,
    top_reactions: [],
    my_reaction: null,
  });
  listPostReactors.mockResolvedValue([
    {
      reaction: "like",
      reactor_pub_id: "hanbyeol-25",
      reactor_name: "이한별",
      reactor_avatar_path: null,
      reacted_at: "2026-08-13T02:00:00Z",
    },
  ]);
});

const noReactions = {
  reaction_count: 0,
  top_reactions: [],
  my_reaction: null,
};

function renderBar(
  overrides: Partial<Parameters<typeof PostActionBar>[0]> = {},
) {
  return renderRoute(() => (
    <PostActionBar
      postId="post-id"
      reaction={noReactions}
      sharePath="/groups/group/posts/post-id"
      shareTitle="제목"
      commentCount={0}
      {...overrides}
    />
  ));
}

describe("PostActionBar", () => {
  it("hides the comment count while nobody has commented", () => {
    renderBar({ commentTo: "/groups/group/posts/post-id" });

    expect(
      screen.getByRole("link", { name: "댓글 0개" }),
    ).not.toHaveTextContent("0");
  });

  it("sends the feed card to the post detail with its comment count", () => {
    renderBar({ commentCount: 7, commentTo: "/groups/group/posts/post-id" });

    const link = screen.getByRole("link", { name: "댓글 7개" });
    expect(link).toHaveAttribute("href", "/groups/group/posts/post-id");
    expect(link).toHaveTextContent("7");
  });

  it("sends the detail view to its own composer", async () => {
    const onComment = vi.fn();
    const { user } = renderBar({ commentCount: 2, onComment });

    await user.click(screen.getByRole("button", { name: "댓글 2개" }));
    expect(onComment).toHaveBeenCalled();
  });

  it("leaves the default reaction on a short press and counts it right away", async () => {
    const { user } = renderBar();

    await user.click(screen.getByRole("button", { name: "반응 남기기" }));

    expect(setPostReaction).toHaveBeenCalledWith("post-id", "like");
    // 서버 응답을 기다리지 않고 먼저 오른다. 응답이 오면 정본으로 덮인다.
    expect(
      await screen.findByRole("button", { name: "좋아요 취소" }),
    ).toBeInTheDocument();
  });

  it("hides the reaction summary until someone reacts", () => {
    renderBar();
    expect(
      screen.queryByRole("button", { name: /반응 \d+개 보기/ }),
    ).not.toBeInTheDocument();
  });

  it("opens the reactor list from the summary", async () => {
    const { user } = renderBar({
      reaction: {
        reaction_count: 3,
        top_reactions: ["like", "love"],
        my_reaction: null,
      },
    });

    await user.click(screen.getByRole("button", { name: "반응 3개 보기" }));

    expect(listPostReactors).toHaveBeenCalledWith("post-id");
    expect(await screen.findByText("이한별")).toBeInTheDocument();
  });
});
