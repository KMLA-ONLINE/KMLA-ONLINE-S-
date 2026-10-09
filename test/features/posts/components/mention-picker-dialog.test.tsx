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

    const active = await screen.findByRole("button", {
      name: /^이미 멘션됨(?! 빼기)/,
    });
    const newTarget = screen.getByRole("button", { name: /^새 대상(?! 빼기)/ });
    expect(active).toBeEnabled();
    expect(newTarget).toBeDisabled();

    await user.click(active);
    expect(onSelect).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "1명 멘션" }));
    expect(onSelect).toHaveBeenCalledWith([
      expect.objectContaining({ pub_id: "active" }),
    ]);
  });

  it("collects several members in the order picked and lets one be dropped", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <MentionPickerDialog
        groupId="group-id"
        remaining={10}
        activeTargetPubIds={[]}
        onOpenChange={vi.fn()}
        onSelect={onSelect}
      />,
    );

    const confirm = screen.getByRole("button", { name: "멘션" });
    expect(confirm).toBeDisabled();

    await user.click(
      await screen.findByRole("button", { name: /^새 대상(?! 빼기)/ }),
    );
    await user.click(
      screen.getByRole("button", { name: /^이미 멘션됨(?! 빼기)/ }),
    );
    expect(
      screen.getByRole("button", { name: /^새 대상(?! 빼기)/ }),
    ).toHaveAttribute("aria-pressed", "true");

    // 검색 결과가 바뀌어도 고른 사람은 남는다.
    searchGroupMentionCandidates.mockResolvedValueOnce([]);
    await user.type(screen.getByRole("searchbox"), "없는 이름{Enter}");
    await screen.findByText("찾는 멤버가 없습니다.");
    await user.click(screen.getByRole("button", { name: "이미 멘션됨 빼기" }));

    await user.click(screen.getByRole("button", { name: "1명 멘션" }));
    expect(onSelect).toHaveBeenCalledWith([
      expect.objectContaining({ pub_id: "new" }),
    ]);
  });

  it("stops new picks once the remaining slots are taken", async () => {
    const user = userEvent.setup();
    render(
      <MentionPickerDialog
        groupId="group-id"
        remaining={1}
        activeTargetPubIds={[]}
        onOpenChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    await user.click(
      await screen.findByRole("button", { name: /^새 대상(?! 빼기)/ }),
    );
    expect(
      screen.getByRole("button", { name: /^이미 멘션됨(?! 빼기)/ }),
    ).toBeDisabled();
    // 고른 사람은 상한에서도 다시 눌러 뺄 수 있다.
    expect(
      screen.getByRole("button", { name: /^새 대상(?! 빼기)/ }),
    ).toBeEnabled();
  });
});
