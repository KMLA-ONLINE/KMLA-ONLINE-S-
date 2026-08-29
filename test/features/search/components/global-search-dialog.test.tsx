import { act } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { useNavigate, useSearchParams } from "react-router";

vi.mock("~/features/search/data/queries", () => ({
  searchDirectory: vi.fn().mockResolvedValue({ people: [], groups: [] }),
}));
vi.mock("~/features/search/hooks/use-recent-search-entries", () => ({
  useRecentSearchEntries: vi.fn().mockReturnValue([]),
}));

import { GlobalSearchDialog } from "~/features/search/components/global-search-dialog";
import { searchDirectory } from "~/features/search/data/queries";
import { useDirectorySearchDialog } from "~/features/search/hooks/use-directory-search-dialog";
import { renderRoute, screen, waitFor } from "../../../router";

let goBack: () => void = () => {
  throw new Error("HomeRoute가 아직 mount되지 않았다.");
};

function HomeRoute() {
  const [searchParams] = useSearchParams();
  const { openSearch } = useDirectorySearchDialog();
  const navigate = useNavigate();

  useEffect(() => {
    goBack = () => void navigate(-1);
  }, [navigate]);

  return (
    <>
      <output data-testid="search-open">
        {searchParams.get("search") ?? ""}
      </output>
      <button type="button" onClick={openSearch}>
        검색 열기
      </button>
      <GlobalSearchDialog />
    </>
  );
}

function renderHome(entry = "/") {
  return renderRoute(HomeRoute, { path: "/", initialEntries: [entry] });
}

describe("GlobalSearchDialog", () => {
  it("opens full screen and searches only after Enter", async () => {
    const { user } = renderHome();
    await user.click(screen.getByRole("button", { name: "검색 열기" }));

    const input = await screen.findByRole("searchbox", {
      name: "사람 · 그룹 검색어",
    });
    await user.type(input, "김민");
    expect(searchDirectory).not.toHaveBeenCalled();

    await user.keyboard("{Enter}");
    await waitFor(() => expect(searchDirectory).toHaveBeenCalledWith("김민"));
  });

  it("closes on the back button instead of leaving home", async () => {
    const { user } = renderHome();
    await user.click(screen.getByRole("button", { name: "검색 열기" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    act(() => {
      goBack();
    });

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("search-open")).toBeEmptyDOMElement();
  });

  it("closes with the X button", async () => {
    const { user } = renderHome();
    await user.click(screen.getByRole("button", { name: "검색 열기" }));
    await user.click(await screen.findByRole("button", { name: "검색 닫기" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });
});
