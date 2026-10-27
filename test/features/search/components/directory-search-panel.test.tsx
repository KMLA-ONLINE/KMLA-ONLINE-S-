import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/features/search/hooks/use-recent-search-entries", () => ({
  useRecentSearchEntries: vi.fn(),
}));
vi.mock("~/features/search/model/recent-searches", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  addRecentSearchEntry: vi.fn(),
}));

import { DirectorySearchPanel } from "~/features/search/components/directory-search-panel";
import { useRecentSearchEntries } from "~/features/search/hooks/use-recent-search-entries";
import { addRecentSearchEntry } from "~/features/search/model/recent-searches";
import { renderRoute, screen } from "../../../router";

describe("DirectorySearchPanel", () => {
  beforeEach(() => {
    vi.mocked(useRecentSearchEntries).mockReturnValue({
      entries: [],
      remove: vi.fn(),
    });
  });

  it("shows recent entries when the query is empty", () => {
    vi.mocked(useRecentSearchEntries).mockReturnValue({
      entries: [
        {
          kind: "profile",
          id: "p1",
          name: "김민준",
          avatarPath: null,
          avatarUrl: null,
        },
      ],
      remove: vi.fn(),
    });

    renderRoute(() => (
      <DirectorySearchPanel
        query=""
        loading={false}
        result={null}
        error={null}
        onNavigate={vi.fn()}
      />
    ));

    expect(screen.getByText("최근 항목")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /김민준/ })).toHaveAttribute(
      "href",
      "/profile/p1",
    );
  });

  it("removes a recent entry without navigating", async () => {
    const remove = vi.fn();
    vi.mocked(useRecentSearchEntries).mockReturnValue({
      entries: [
        {
          kind: "group",
          id: "g1",
          name: "화학 스터디",
          avatarPath: null,
          avatarUrl: null,
        },
      ],
      remove,
    });
    const onNavigate = vi.fn();
    const { user } = renderRoute(() => (
      <DirectorySearchPanel
        query=""
        loading={false}
        result={null}
        error={null}
        onNavigate={onNavigate}
      />
    ));

    await user.click(
      screen.getByRole("button", { name: "화학 스터디 최근 항목에서 삭제" }),
    );

    expect(remove).toHaveBeenCalledWith("group", "g1");
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("shows placeholder rows while loading", () => {
    renderRoute(() => (
      <DirectorySearchPanel
        query="김민"
        loading
        result={null}
        error={null}
        onNavigate={vi.fn()}
      />
    ));

    expect(
      screen.getByRole("region", { name: "검색 결과를 불러오는 중" }),
    ).toHaveAttribute("aria-busy", "true");
  });

  it("shows an empty state when nothing matches", () => {
    renderRoute(() => (
      <DirectorySearchPanel
        query="없음"
        loading={false}
        result={{ people: [], groups: [] }}
        error={null}
        onNavigate={vi.fn()}
      />
    ));

    expect(screen.getByText(/없음.*결과가 없습니다/)).toBeInTheDocument();
  });

  it("renders people and groups, records a recent entry, and calls onNavigate on click", async () => {
    const onNavigate = vi.fn();
    const { user } = renderRoute(() => (
      <DirectorySearchPanel
        query="김민"
        loading={false}
        result={{
          people: [
            {
              kind: "profile",
              id: "p1",
              name: "김민준",
              avatarPath: null,
              avatarUrl: null,
            },
          ],
          groups: [
            {
              kind: "group",
              id: "g1",
              name: "김민 스터디",
              avatarPath: null,
              avatarUrl: null,
            },
          ],
        }}
        error={null}
        onNavigate={onNavigate}
      />
    ));

    expect(screen.getByRole("link", { name: /김민준/ })).toHaveAttribute(
      "href",
      "/profile/p1",
    );
    const groupLink = screen.getByRole("link", { name: /김민 스터디/ });
    expect(groupLink).toHaveAttribute("href", "/groups/g1");

    await user.click(groupLink);
    expect(addRecentSearchEntry).toHaveBeenCalledWith({
      kind: "group",
      id: "g1",
      name: "김민 스터디",
      avatarPath: null,
    });
    expect(onNavigate).toHaveBeenCalledOnce();
  });

  it("shows an error message", () => {
    renderRoute(() => (
      <DirectorySearchPanel
        query="김민"
        loading={false}
        result={null}
        error="검색 결과를 불러오지 못했습니다."
        onNavigate={vi.fn()}
      />
    ));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "검색 결과를 불러오지 못했습니다.",
    );
  });
});
