import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  CommentReactionButton,
  CommentReactionSummary,
} from "~/features/posts/components/comment/comment-reaction-button";
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

  it("opens the picker to change an existing reaction", async () => {
    const { user, onSelect, onClear } = renderButton({
      my_reaction: "haha",
      reaction_count: 1,
      top_reactions: ["haha"],
    });

    // 누르자마자 지우면 종류를 바꾸려 해도 한 번 지워야 하고, 잘못 누른 손에 반응이 사라진다.
    await user.click(
      screen.getByRole("button", { name: "웃겨요 반응 바꾸기" }),
    );
    expect(onClear).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "하트 반응 남기기" }));

    expect(onSelect).toHaveBeenCalledWith("love");
    expect(onClear).not.toHaveBeenCalled();
  });

  it("removes the reaction when the picker repeats it", async () => {
    const { user, onClear } = renderButton({
      my_reaction: "haha",
      reaction_count: 1,
      top_reactions: ["haha"],
    });

    await user.click(
      screen.getByRole("button", { name: "웃겨요 반응 바꾸기" }),
    );
    await user.click(screen.getByRole("button", { name: "웃겨요 반응 취소" }));

    expect(onClear).toHaveBeenCalled();
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
