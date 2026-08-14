import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GroupPostSearchDialog } from "~/features/posts/components/group-post-search-dialog";
import { searchGroupPosts } from "~/features/posts/data/queries";
import type { GroupPostSearchResult } from "~/features/posts/model/types";
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

  it("ignores an older response that resolves after a newer search", async () => {
    let resolveFirst!: (value: GroupPostSearchResult[]) => void;
    vi.mocked(searchGroupPosts)
      .mockImplementationOnce(
        () => new Promise((resolve) => (resolveFirst = resolve)),
      )
      .mockResolvedValueOnce([
        {
          post_id: "new",
          title: "새 결과",
          body: "",
          category_name: null,
          author_name: "작성자",
          author_label: "작성자",
          published_at: new Date().toISOString(),
          edited_at: null,
        } as unknown as GroupPostSearchResult,
      ]);
    const { user } = renderRoute(() => (
      <GroupPostSearchDialog
        open
        onOpenChange={vi.fn()}
        groupId="group-id"
        slug="group"
      />
    ));
    const input = screen.getByRole("textbox", { name: "게시물 검색어" });

    await user.type(input, "이전{Enter}");
    await user.clear(input);
    await user.type(input, "새 검색{Enter}");
    expect(await screen.findByText("새 결과")).toBeInTheDocument();
    resolveFirst([
      {
        post_id: "old",
        title: "이전 결과",
        body: "",
        category_name: null,
        author_name: "작성자",
        author_label: "작성자",
        published_at: new Date().toISOString(),
        edited_at: null,
      } as unknown as GroupPostSearchResult,
    ]);

    await waitFor(() =>
      expect(screen.queryByText("이전 결과")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("새 결과")).toBeInTheDocument();
  });
});
