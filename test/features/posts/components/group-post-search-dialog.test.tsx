import { act, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useNavigate, useSearchParams } from "react-router";

import { GroupPostSearchDialog } from "~/features/posts/components/group-post-search-dialog";
import { searchGroupPosts } from "~/features/posts/data/queries";
import { useGroupPostSearch } from "~/features/posts/hooks/use-group-post-search";
import type { GroupPostSearchResult } from "~/features/posts/model/types";
import { renderRoute } from "../../../router";

vi.mock("~/features/posts/data/queries", () => ({
  searchGroupPosts: vi.fn().mockResolvedValue([]),
}));

function result(
  post: Partial<GroupPostSearchResult> & { post_id: string; title: string },
): GroupPostSearchResult {
  return {
    body: "",
    category_name: null,
    author_name: "작성자",
    author_label: "작성자",
    published_at: new Date().toISOString(),
    edited_at: null,
    ...post,
  } as unknown as GroupPostSearchResult;
}

/**
 * 브라우저 뒤로가기. 열린 dialog는 뒤의 화면을 inert로 만들기 때문에 화면 안의 버튼으로는
 * 흉내 낼 수 없다 — 실제 뒤로가기와 마찬가지로 history를 직접 pop한다.
 */
let goBack: () => void = () => {
  throw new Error("GroupRoute가 아직 mount되지 않았다.");
};

/** 열림 상태가 URL에 있으므로 dialog는 언제나 route 위에서 그린다. */
function GroupRoute() {
  const [searchParams] = useSearchParams();
  const { openSearch } = useGroupPostSearch();
  const navigate = useNavigate();

  useEffect(() => {
    goBack = () => void navigate(-1);
  }, [navigate]);

  return (
    <>
      <output data-testid="search-open">
        {searchParams.get("search") ?? ""}
      </output>
      <output data-testid="search-query">{searchParams.get("q") ?? ""}</output>
      <button type="button" onClick={openSearch}>
        검색 열기
      </button>
      <GroupPostSearchDialog groupId="group-id" slug="group" />
    </>
  );
}

function renderSearch(entry = "/groups/group?search=1") {
  return renderRoute(GroupRoute, {
    path: "/groups/:slug",
    initialEntries: [entry],
  });
}

const searchInput = () =>
  screen.getByRole("searchbox", { name: "게시물 검색어" });

describe("GroupPostSearchDialog", () => {
  beforeEach(() => {
    vi.mocked(searchGroupPosts).mockReset();
    vi.mocked(searchGroupPosts).mockResolvedValue([]);
  });

  it("searches only after the query is submitted", async () => {
    const { user } = renderSearch();

    await user.type(searchInput(), "프로젝트");
    expect(searchGroupPosts).not.toHaveBeenCalled();

    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(searchGroupPosts).toHaveBeenCalledWith("group-id", "프로젝트"),
    );
  });

  it("does not submit while a Hangul syllable is still composing", async () => {
    const { user } = renderSearch();

    const input = searchInput();
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
      .mockResolvedValueOnce([result({ post_id: "new", title: "새 결과" })]);
    const { user } = renderSearch();

    await user.type(searchInput(), "이전{Enter}");
    await user.clear(searchInput());
    await user.type(searchInput(), "새 검색{Enter}");
    expect(await screen.findByText("새 결과")).toBeInTheDocument();
    resolveFirst([result({ post_id: "old", title: "이전 결과" })]);

    await waitFor(() =>
      expect(screen.queryByText("이전 결과")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("새 결과")).toBeInTheDocument();
  });

  it("closes on the back button instead of leaving the group", async () => {
    // 모바일에서 검색은 전체화면이라 뒤로가기로 닫는 사람이 많다. 그 뒤로가기가 그룹을 떠나면
    // 안 되므로 검색을 열 때 history entry를 하나 쌓아 둔다.
    const { user } = renderSearch("/groups/group");
    await user.click(screen.getByRole("button", { name: "검색 열기" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    act(() => {
      goBack();
    });

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("search-open")).toBeEmptyDOMElement();
    expect(
      screen.getByRole("button", { name: "검색 열기" }),
    ).toBeInTheDocument();
  });

  it("closes with the X button", async () => {
    const { user } = renderSearch("/groups/group");
    await user.click(screen.getByRole("button", { name: "검색 열기" }));

    await user.click(await screen.findByRole("button", { name: "검색 닫기" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("search-open")).toBeEmptyDOMElement();
  });

  it("leaves a single history entry however often the query changes", async () => {
    const { user } = renderSearch("/groups/group");
    await user.click(screen.getByRole("button", { name: "검색 열기" }));

    await user.type(
      await screen.findByRole("searchbox", { name: "게시물 검색어" }),
      "첫 검색{Enter}",
    );
    await waitFor(() =>
      expect(screen.getByTestId("search-query")).toHaveTextContent("첫 검색"),
    );
    await user.clear(searchInput());
    await user.type(searchInput(), "두 번째{Enter}");
    await waitFor(() =>
      expect(screen.getByTestId("search-query")).toHaveTextContent("두 번째"),
    );

    // 제출이 entry를 쌓았다면 이 뒤로가기는 첫 검색으로 돌아갔을 것이다.
    act(() => {
      goBack();
    });

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("search-open")).toBeEmptyDOMElement();
  });

  it("restores the submitted query and its results from the URL", async () => {
    // 결과에서 게시물로 들어갔다가 뒤로가기로 돌아온 자리다.
    vi.mocked(searchGroupPosts).mockResolvedValue([
      result({ post_id: "post-1", title: "지난 검색 결과" }),
    ]);
    renderSearch("/groups/group?search=1&q=%EC%8B%9C%ED%97%98");

    expect(await screen.findByText("지난 검색 결과")).toBeInTheDocument();
    expect(searchGroupPosts).toHaveBeenCalledWith("group-id", "시험");
    expect(searchInput()).toHaveValue("시험");
    // 보러 온 것은 결과 목록이다. 여기서 포커스를 주면 모바일 키보드가 그 위를 덮는다.
    expect(searchInput()).not.toHaveFocus();
  });

  it("clears the query and results when reopened after closing", async () => {
    // 기능 명세 §8.9. 닫을 때 손으로 지우지 않고 dialog가 unmount되는 데 기대고 있다.
    const { user } = renderSearch("/groups/group");
    await user.click(screen.getByRole("button", { name: "검색 열기" }));
    await user.type(
      await screen.findByRole("searchbox", { name: "게시물 검색어" }),
      "시험{Enter}",
    );
    await waitFor(() =>
      expect(searchGroupPosts).toHaveBeenCalledWith("group-id", "시험"),
    );

    await user.click(screen.getByRole("button", { name: "검색 닫기" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: "검색 열기" }));

    expect(
      await screen.findByRole("searchbox", { name: "게시물 검색어" }),
    ).toHaveValue("");
    expect(screen.getByText("제목이나 내용으로 검색해 보세요.")).toBeVisible();
    await waitFor(() => expect(searchInput()).toHaveFocus());
  });

  it("opens with an empty query even when the last search is still in the URL", async () => {
    const { user } = renderSearch("/groups/group?q=%EC%8B%9C%ED%97%98");
    await user.click(screen.getByRole("button", { name: "검색 열기" }));

    expect(
      await screen.findByRole("searchbox", { name: "게시물 검색어" }),
    ).toHaveValue("");
    expect(searchGroupPosts).not.toHaveBeenCalled();
  });
});
