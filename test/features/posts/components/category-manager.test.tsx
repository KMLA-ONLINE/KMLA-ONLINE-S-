import { describe, expect, it, vi } from "vitest";

import { CategoryManager } from "~/features/posts/components/category-manager";
import { renderRoute, screen, waitFor } from "../../../router";

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

function renderManager(options?: Parameters<typeof renderRoute>[1]) {
  return renderRoute(
    () => <CategoryManager groupId="group-1" categories={categories} />,
    options,
  );
}

/**
 * One confirmation path per test. Mounting a dialog is the expensive step here,
 * so walking all three in a single test — and cancelling back out of each one —
 * ran past the 5s timeout whenever the rest of the suite was competing for the
 * machine.
 */
describe("CategoryManager", () => {
  it("confirms before creating a category", async () => {
    const { user } = renderManager();

    await user.type(screen.getByLabelText("새 카테고리 이름"), "자");
    await user.click(screen.getByRole("button", { name: "추가" }));

    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "카테고리 생성",
    );
  });

  it("confirms before saving a renamed category", async () => {
    const { user } = renderManager();

    await user.click(screen.getAllByRole("button", { name: "저장" })[0]);

    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "카테고리 저장",
    );
  });

  it("confirms before deleting a category", async () => {
    const { user } = renderManager();

    await user.click(screen.getByRole("button", { name: "공지 삭제" }));

    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "카테고리 삭제",
    );
  });

  it("moves a category without a confirmation dialog", async () => {
    const submitted = vi.fn();

    const { user } = renderManager({
      action: async ({ request }) => {
        submitted((await request.formData()).get("intent"));
        return null;
      },
    });

    await user.click(screen.getByRole("button", { name: "공지 아래로" }));

    await waitFor(() =>
      expect(submitted).toHaveBeenCalledWith("move-category-down"),
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
