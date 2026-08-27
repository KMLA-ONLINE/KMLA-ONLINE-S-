import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  CommentReactionButton,
  CommentReactionSummary,
} from "~/features/posts/components/comment-reaction-button";
import type { ReactionSummary } from "~/features/posts/model/types";

function renderButton(summary: Partial<ReactionSummary> = {}) {
  const onSelect = vi.fn();
  const onClear = vi.fn();
  render(
    <CommentReactionButton
      summary={{
        reaction_count: 0,
        top_reactions: [],
        my_reaction: null,
        ...summary,
      }}
      onSelect={onSelect}
      onClear={onClear}
    />,
  );
  return { user: userEvent.setup(), onSelect, onClear };
}

describe("CommentReactionButton", () => {
  it("opens the picker when nothing is chosen yet", async () => {
    const { user, onSelect } = renderButton();

    // 게시물 버튼과 달리 롱프레스가 없다. 댓글 줄의 아이콘은 짧게/길게를 나누기에 너무 작다.
    await user.click(screen.getByRole("button", { name: "반응 남기기" }));
    await user.click(screen.getByRole("button", { name: "하트 반응 남기기" }));

    expect(onSelect).toHaveBeenCalledWith("love");
  });

  it("removes the reaction in place instead of reopening the picker", async () => {
    const { user, onClear } = renderButton({
      my_reaction: "haha",
      reaction_count: 1,
      top_reactions: ["haha"],
    });

    await user.click(screen.getByRole("button", { name: "웃겨요 취소" }));

    expect(onClear).toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "하트 반응 남기기" }),
    ).not.toBeInTheDocument();
  });
});

describe("CommentReactionSummary", () => {
  function renderSummary(summary: Partial<ReactionSummary> = {}) {
    render(
      <CommentReactionSummary
        summary={{
          reaction_count: 0,
          top_reactions: [],
          my_reaction: null,
          ...summary,
        }}
        onOpen={vi.fn()}
      />,
    );
  }

  it("shows only the most used reaction with the total", () => {
    renderSummary({ reaction_count: 5, top_reactions: ["love", "haha"] });

    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByAltText("하트")).toBeInTheDocument();
    expect(screen.queryByAltText("웃겨요")).not.toBeInTheDocument();
  });

  it("stays out of the way while nobody has reacted", () => {
    renderSummary();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
