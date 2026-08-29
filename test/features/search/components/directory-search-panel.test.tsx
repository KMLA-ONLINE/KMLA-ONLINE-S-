import { describe, expect, it, vi } from "vitest";

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
  it("shows recent entries when the query is empty", () => {
    vi.mocked(useRecentSearchEntries).mockReturnValue([
      {
        kind: "profile",
        id: "p1",
        name: "김민준",
        avatarPath: null,
        avatarUrl: null,
      },
    ]);

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

  it("shows a spinner while loading", () => {
    vi.mocked(useRecentSearchEntries).mockReturnValue([]);
    renderRoute(() => (
      <DirectorySearchPanel
        query="김민"
        loading
        result={null}
        error={null}
        onNavigate={vi.fn()}
      />
    ));

    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("shows an empty state when nothing matches", () => {
    vi.mocked(useRecentSearchEntries).mockReturnValue([]);
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
    vi.mocked(useRecentSearchEntries).mockReturnValue([]);
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
    vi.mocked(useRecentSearchEntries).mockReturnValue([]);
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
