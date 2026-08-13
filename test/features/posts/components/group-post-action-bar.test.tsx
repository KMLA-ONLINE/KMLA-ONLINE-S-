import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { GroupPostActionBar } from "~/features/posts/components/group-post-action-bar";

describe("GroupPostActionBar", () => {
  it("keeps reaction and comment slots disabled until those features land", () => {
    render(
      <GroupPostActionBar
        sharePath="/groups/group/posts/post-id"
        shareTitle="제목"
      />,
    );

    expect(
      screen.getByRole("button", { name: "좋아요 (준비 중)" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "댓글 (준비 중)" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "공유" })).toBeEnabled();
  });
});
