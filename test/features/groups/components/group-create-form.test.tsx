import { describe, expect, it } from "vitest";

import { GroupCreateForm } from "~/features/groups/components/group-create-form";
import { renderRoute, screen, within } from "../../../router";

describe("GroupCreateForm", () => {
  it("offers identified and optional-anonymous activity", () => {
    renderRoute(() => (
      <GroupCreateForm canCreateOfficial={false} pending={false} />
    ));

    const identity = screen.getByRole("combobox", { name: "활동 신원" });
    expect(identity).toHaveValue("optional_anonymous");
    expect(within(identity).getAllByRole("option")).toHaveLength(2);
    expect(
      within(identity).getByRole("option", { name: "실명만" }),
    ).toBeVisible();
    expect(
      within(identity).getByRole("option", { name: "작성할 때 선택" }),
    ).toBeVisible();
  });
});
