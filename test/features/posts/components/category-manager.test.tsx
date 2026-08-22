import { describe, expect, it } from "vitest";

import { CategoryManager } from "~/features/posts/components/category-manager";
import { renderRoute, screen } from "../../../router";

const categories = [
  {
    id: "category-1",
    group_id: "group-1",
    name: "공지",
    position: 0,
    created_at: "",
    updated_at: "",
  },
  {
    id: "category-2",
    group_id: "group-1",
    name: "질문",
    position: 1,
    created_at: "",
    updated_at: "",
  },
];

describe("CategoryManager", () => {
  it("confirms category creation, saving, and deletion", async () => {
    const { user } = renderRoute(() => (
      <CategoryManager groupId="group-1" categories={categories} />
    ));

    await user.type(screen.getByLabelText("새 카테고리 이름"), "자료");
    await user.click(screen.getByRole("button", { name: "추가" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("카테고리 생성");
    await user.click(screen.getByRole("button", { name: "취소" }));

    await user.click(screen.getAllByRole("button", { name: "저장" })[0]);
    expect(screen.getByRole("dialog")).toHaveTextContent("카테고리 저장");
    await user.click(screen.getByRole("button", { name: "취소" }));

    await user.click(screen.getByRole("button", { name: "공지 삭제" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("카테고리 삭제");
  });

  it("moves categories without a confirmation dialog", async () => {
    const { user } = renderRoute(() => (
      <CategoryManager groupId="group-1" categories={categories} />
    ));

    await user.click(screen.getByRole("button", { name: "공지 아래로" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
