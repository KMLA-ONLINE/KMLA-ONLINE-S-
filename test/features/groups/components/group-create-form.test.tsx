import { describe, expect, it } from "vitest";

import { GroupCreateForm } from "~/features/groups/components/group-create-form";
import { renderRoute, screen } from "../../../router";

const WARNING = /다른 신원 정책으로 바꿀 수 없습니다/;

describe("GroupCreateForm", () => {
  it("warns only once always-anonymous is picked", async () => {
    // 되돌릴 수 없는 선택이다. 고르기 전에는 잔소리가 되고, 고른 뒤에 알리면 늦는다.
    const { user } = renderRoute(() => (
      <GroupCreateForm canCreateOfficial={false} pending={false} />
    ));

    expect(screen.queryByText(WARNING)).not.toBeInTheDocument();

    await user.selectOptions(
      screen.getByRole("combobox", { name: "활동 신원" }),
      "always_anonymous",
    );
    expect(screen.getByText(WARNING)).toBeVisible();

    await user.selectOptions(
      screen.getByRole("combobox", { name: "활동 신원" }),
      "identified",
    );
    expect(screen.queryByText(WARNING)).not.toBeInTheDocument();
  });
});
