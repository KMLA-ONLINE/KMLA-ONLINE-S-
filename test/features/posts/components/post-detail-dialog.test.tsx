import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PostDetailDialog } from "~/features/posts/components/post-detail-dialog";
import { renderRoute } from "../../../router";

function Detail() {
  return (
    <PostDetailDialog
      title="게시물"
      postId="post-id"
      comments={{ comments: [], nextCursor: null }}
      viewer={{ name: "홍길동", avatarUrl: null }}
      identities={["identified"]}
      onClose={vi.fn()}
      actionBar={{
        reaction: {
          reaction_count: 0,
          top_reactions: [],
          my_reaction: null,
        },
        sharePath: "/posts/post-id",
        shareTitle: "게시물",
        commentCount: 0,
      }}
    >
      <p>게시물 본문</p>
    </PostDetailDialog>
  );
}

describe("PostDetailDialog", () => {
  it("focuses the composer when opened from a comment button", async () => {
    renderRoute(Detail, {
      path: "/posts/:postId",
      initialEntries: ["/posts/post-id?view=comments"],
    });

    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "댓글 입력" })).toHaveFocus(),
    );
  });

  it("does not focus the composer for a regular detail link", async () => {
    renderRoute(Detail, {
      path: "/posts/:postId",
      initialEntries: ["/posts/post-id"],
    });

    await waitFor(() => expect(screen.getByRole("dialog")).toHaveFocus());
    expect(
      screen.getByRole("textbox", { name: "댓글 입력" }),
    ).not.toHaveFocus();
  });
});
