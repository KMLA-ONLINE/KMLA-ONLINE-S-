import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { searchGroupMentionCandidates } = vi.hoisted(() => ({
  searchGroupMentionCandidates: vi.fn(),
}));

vi.mock("~/features/posts/data/queries", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  searchGroupMentionCandidates,
}));

import { MentionPickerDialog } from "~/features/posts/components/mention-picker-dialog";

describe("MentionPickerDialog", () => {
  beforeEach(() => {
    searchGroupMentionCandidates.mockResolvedValue([
      {
        pub_id: "active",
        name: "이미 멘션됨",
        cohort: 30,
        is_returning_student: false,
        profile_type: "student",
        avatar_path: null,
      },
      {
        pub_id: "new",
        name: "새 대상",
        cohort: 31,
        is_returning_student: false,
        profile_type: "student",
        avatar_path: null,
      },
    ]);
  });

  it("keeps an active target selectable at the limit and disables only new targets", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <MentionPickerDialog
        groupId="group-id"
        remaining={0}
        activeTargetPubIds={["active"]}
        onOpenChange={vi.fn()}
        onSelect={onSelect}
      />,
    );

    const active = await screen.findByRole("button", { name: /이미 멘션됨/ });
    const newTarget = screen.getByRole("button", { name: /새 대상/ });
    expect(active).toBeEnabled();
    expect(newTarget).toBeDisabled();

    await user.click(active);
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ pub_id: "active" }),
    );
  });
});
