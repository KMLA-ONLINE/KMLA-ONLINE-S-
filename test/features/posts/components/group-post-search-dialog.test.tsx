import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GroupPostSearchDialog } from "~/features/posts/components/group-post-search-dialog";
import { searchGroupPosts } from "~/features/posts/data/queries";
import { renderRoute } from "../../../router";

vi.mock("~/features/posts/data/queries", () => ({
  searchGroupPosts: vi.fn().mockResolvedValue([]),
}));

describe("GroupPostSearchDialog", () => {
  beforeEach(() => vi.mocked(searchGroupPosts).mockClear());

  it("searches only after the query is submitted", async () => {
    const { user } = renderRoute(() => (
      <GroupPostSearchDialog
        open
        onOpenChange={vi.fn()}
        groupId="group-id"
        slug="group"
      />
    ));

    const input = screen.getByRole("textbox", { name: "게시물 검색어" });
    await user.type(input, "프로젝트");
    expect(searchGroupPosts).not.toHaveBeenCalled();

    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(searchGroupPosts).toHaveBeenCalledWith("group-id", "프로젝트"),
    );
  });

  it("does not submit while a Hangul syllable is still composing", async () => {
    const { user } = renderRoute(() => (
      <GroupPostSearchDialog
        open
        onOpenChange={vi.fn()}
        groupId="group-id"
        slug="group"
      />
    ));

    const input = screen.getByRole("textbox", { name: "게시물 검색어" });
    await user.type(input, "프로");
    // 조합이 끝나지 않은 상태에서의 Enter는 글자를 확정하는 키다.
    await user.pointer({ target: input });
    input.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    await user.keyboard("{Enter}");

    expect(searchGroupPosts).not.toHaveBeenCalled();
  });
});
