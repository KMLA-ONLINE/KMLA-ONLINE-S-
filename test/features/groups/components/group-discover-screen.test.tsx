import { afterEach, describe, expect, it, vi } from "vitest";

import { GroupDiscoverScreen } from "~/features/groups/components/group-discover-screen";
import { renderRoute, screen } from "../../../router";

function DiscoverRoute({ query = "" }: { query?: string }) {
  return (
    <GroupDiscoverScreen
      initialPage={{ groups: [], nextCursor: null }}
      query={query}
      includeJoined={false}
      profileId={1}
      searchOpen={Boolean(query)}
      focusSearch={false}
      onSearchOpenChange={vi.fn()}
    />
  );
}

describe("GroupDiscoverScreen", () => {
  it("shows the empty state in Korean by default", () => {
    renderRoute(() => <DiscoverRoute />, { path: "/groups/discover" });

    expect(
      screen.getByText("가입할 수 있는 공개 그룹이 없습니다."),
    ).toBeVisible();
  });

  describe("in English", () => {
    afterEach(() => window.localStorage.clear());

    it("renders the discovery screen in English", () => {
      window.localStorage.setItem("kmla-online:language:v1", "en");
      renderRoute(() => <DiscoverRoute query="math" />, {
        path: "/groups/discover",
      });

      expect(
        screen.getByRole("heading", { name: "Find unofficial groups" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("searchbox", { name: "Group name" }),
      ).toBeVisible();
      expect(
        screen.getByRole("button", { name: "Search groups" }),
      ).toBeVisible();
      expect(
        screen.getByRole("button", { name: "Close search" }),
      ).toBeVisible();
      expect(screen.getByText("Show joined groups")).toBeVisible();
      expect(screen.getByText("No groups match “math”.")).toBeVisible();
      expect(screen.getByText("Try a different search term.")).toBeVisible();
    });
  });
});
