import { describe, expect, it, vi } from "vitest";

import { PollShelf } from "~/features/herald/components/poll-shelf";
import type { HeraldPoll } from "~/features/herald/model/types";
import { renderRoute, screen, within } from "../../../router";

const makePoll = (id: string, closed = false): HeraldPoll => ({
  id,
  title: `Question ${id}`,
  closed,
  choice: null,
  options: [
    { id: "yes", label: "Yes", votes: 3 },
    { id: "no", label: "No", votes: 2 },
  ],
});
const polls = [
  makePoll("new"),
  makePoll("second"),
  makePoll("older"),
  ...[1, 2, 3, 4, 5].map((id) => makePoll(`past-${id}`, true)),
];

describe("Herald poll shelf", () => {
  it("limits the sidebar to two current polls and four past links while keeping every poll accessible", async () => {
    const onVote = vi.fn();
    const { user } = renderRoute(() => (
      <PollShelf polls={polls} onVote={onVote} />
    ));
    expect(screen.getAllByRole("button", { name: "Vote" })).toHaveLength(2);
    expect(
      screen.queryByRole("region", { name: "Question older" }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^View poll:/ })).toHaveLength(
      4,
    );
    expect(
      screen.queryByRole("button", { name: "View poll: Question past-5" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "View all polls" }));
    const archive = within(
      screen.getByRole("dialog", { name: "Poll archive" }),
    );
    expect(
      archive.getAllByRole("button", { name: /^View poll:/ }),
    ).toHaveLength(8);
    await user.click(
      archive.getByRole("button", { name: "View poll: Question older" }),
    );
    const reader = within(
      screen.getByRole("dialog", { name: "Question older" }),
    );
    await user.click(reader.getByRole("radio", { name: "Yes" }));
    await user.click(reader.getByRole("button", { name: "Vote" }));
    expect(onVote).toHaveBeenCalledWith("older", "yes");
  });
});
