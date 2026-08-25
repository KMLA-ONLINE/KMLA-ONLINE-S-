import { describe, expect, it } from "vitest";
import { useSearchParams } from "react-router";

import { GroupDetailMobileHeader } from "~/features/groups/components/group-detail-mobile-header";
import { renderRoute, screen } from "../../../router";

/** 헤더는 검색창을 그리지 않는다. URL만 열고, 검색창은 `GroupDetailScreen`이 하나 그린다. */
function HeaderRoute({ canSearch }: { canSearch: boolean }) {
  const [searchParams] = useSearchParams();

  return (
    <>
      <output data-testid="search-open">
        {searchParams.get("search") ?? ""}
      </output>
      <GroupDetailMobileHeader
        name="테스트 그룹"
        iconPath={null}
        canSearch={canSearch}
      />
    </>
  );
}

describe("GroupDetailMobileHeader", () => {
  it("opens group post search for members", async () => {
    const { user } = renderRoute(() => <HeaderRoute canSearch />, {
      path: "/groups/:slug",
      initialEntries: ["/groups/test-group"],
    });

    const searchButton = screen.getByRole("button", { name: "게시물 검색" });
    expect(searchButton).toHaveClass(
      "focus-visible:border-transparent",
      "focus-visible:ring-0",
    );

    await user.click(searchButton);
    expect(screen.getByTestId("search-open")).toHaveTextContent("1");
  });

  it("hides search from non-members", () => {
    renderRoute(() => <HeaderRoute canSearch={false} />, {
      path: "/groups/:slug",
      initialEntries: ["/groups/test-group"],
    });

    expect(
      screen.queryByRole("button", { name: "게시물 검색" }),
    ).not.toBeInTheDocument();
  });
});
