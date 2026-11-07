import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MessagePollCard } from "~/features/messaging/components/message-poll-card";
import type { MessagePoll } from "~/features/messaging/model/types";

const poll: MessagePoll = {
  multiple: false,
  closedAt: null,
  options: [
    { id: "a", label: "김밥", count: 1, voterIds: ["x"] },
    { id: "b", label: "라면", count: 2, voterIds: ["y", "z"] },
  ],
  myOptionIds: ["a"],
};

describe("MessagePollCard", () => {
  it("shows the question, the options with counts and lets a member vote", async () => {
    const user = userEvent.setup();
    const onVote = vi.fn();
    render(
      <MessagePollCard
        question="점심 뭐 먹지?"
        poll={poll}
        isOwn={false}
        canVote
        onVote={onVote}
        onShowVoters={vi.fn()}
      />,
    );

    expect(screen.getByText("점심 뭐 먹지?")).toBeInTheDocument();
    const gimbap = screen.getByRole("button", { name: /김밥/ });
    expect(gimbap).toHaveAttribute("aria-pressed", "true");
    expect(within(gimbap).getByText("1명")).toBeInTheDocument();
    expect(screen.getByText("3명 참여")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /라면/ }));
    expect(onVote).toHaveBeenCalledWith(["b"]);

    await user.click(gimbap);
    expect(onVote).toHaveBeenCalledWith([]);
  });

  it("offers closing only to the author while open, and freezes a closed poll", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { rerender } = render(
      <MessagePollCard
        question="q"
        poll={poll}
        isOwn
        canVote
        onVote={vi.fn()}
        onClose={onClose}
        onShowVoters={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "투표 종료" }));
    expect(onClose).toHaveBeenCalled();

    rerender(
      <MessagePollCard
        question="q"
        poll={{ ...poll, closedAt: "2026-11-07T00:00:00Z" }}
        isOwn
        canVote
        onVote={vi.fn()}
        onClose={onClose}
        onShowVoters={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "투표 종료" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("투표 종료됨")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /김밥/ })).toBeDisabled();
  });
});
