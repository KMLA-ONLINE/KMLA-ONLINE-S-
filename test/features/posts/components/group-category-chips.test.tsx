import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { GroupCategoryChips } from "~/features/posts/components/group-category-chips";

describe("GroupCategoryChips", () => {
  it("exposes category filters as pressed buttons", () => {
    render(
      <GroupCategoryChips
        categories={[
          {
            id: "notice",
            group_id: "group",
            name: "공지",
            position: 0,
            created_at: "",
            updated_at: "",
          },
        ]}
        selected="notice"
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByRole("group", { name: "카테고리" })).toBeVisible();
    expect(screen.getByRole("button", { name: "전체" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "공지" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
