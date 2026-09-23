import { describe, expect, it, vi } from "vitest";

vi.mock("~/features/search/data/queries", () => ({
  searchDirectory: vi.fn(),
}));
vi.mock("~/features/search/hooks/use-recent-search-entries", () => ({
  useRecentSearchEntries: vi.fn().mockReturnValue([]),
}));

import { GlobalSearchDropdown } from "~/features/search/components/global-search-dropdown";
import { searchDirectory } from "~/features/search/data/queries";
import { renderRoute, screen, waitFor } from "../../../router";

describe("GlobalSearchDropdown", () => {
  it("stays closed until the input is focused", () => {
    renderRoute(() => <GlobalSearchDropdown />);
    expect(screen.queryByText("최근 항목")).not.toBeInTheDocument();
  });

  it("does not search until Enter, and rejects fewer than two characters", async () => {
    const { user } = renderRoute(() => <GlobalSearchDropdown />);
    const input = screen.getByRole("searchbox", { name: "사람 · 그룹 검색" });

    await user.click(input);
    await user.type(input, "김");
    expect(searchDirectory).not.toHaveBeenCalled();

    await user.keyboard("{Enter}");
    expect(searchDirectory).not.toHaveBeenCalled();

    await user.type(input, "민");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(searchDirectory).toHaveBeenCalledWith("김민"));
  });

  it("closes on outside click", async () => {
    vi.mocked(searchDirectory).mockResolvedValue({ people: [], groups: [] });
    const { user } = renderRoute(() => (
      <div>
        <GlobalSearchDropdown />
        <button type="button">밖</button>
      </div>
    ));

    await user.click(
      screen.getByRole("searchbox", { name: "사람 · 그룹 검색" }),
    );
    expect(screen.getByText(/검색해 보세요/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "밖" }));
    expect(screen.queryByText(/검색해 보세요/)).not.toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    const { user } = renderRoute(() => <GlobalSearchDropdown />);
    const input = screen.getByRole("searchbox", { name: "사람 · 그룹 검색" });
    await user.click(input);
    expect(screen.getByText(/검색해 보세요/)).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByText(/검색해 보세요/)).not.toBeInTheDocument();
  });
});
