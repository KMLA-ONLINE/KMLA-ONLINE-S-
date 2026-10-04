import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/features/search/data/queries", () => ({
  resolveRecentSearchEntryUrls: vi.fn(),
}));

import { resolveRecentSearchEntryUrls } from "~/features/search/data/queries";
import { useRecentSearchEntries } from "~/features/search/hooks/use-recent-search-entries";
import { addRecentSearchEntry } from "~/features/search/model/recent-searches";

describe("useRecentSearchEntries", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(resolveRecentSearchEntryUrls).mockResolvedValue(new Map());
  });

  it("does nothing while inactive", () => {
    addRecentSearchEntry({
      kind: "profile",
      id: "p1",
      name: "김민준",
      avatarPath: null,
    });

    const { result } = renderHook(() => useRecentSearchEntries(false));
    expect(result.current).toEqual([]);
    expect(resolveRecentSearchEntryUrls).not.toHaveBeenCalled();
  });

  it("reads storage and attaches resolved avatar URLs once active", async () => {
    addRecentSearchEntry({
      kind: "profile",
      id: "p1",
      name: "김민준",
      avatarPath: "avatar/1",
    });
    vi.mocked(resolveRecentSearchEntryUrls).mockResolvedValue(
      new Map([["profile:avatar/1", "https://signed/1"]]),
    );

    const { result } = renderHook(() => useRecentSearchEntries(true));

    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(result.current[0]).toEqual({
      kind: "profile",
      id: "p1",
      name: "김민준",
      avatarPath: "avatar/1",
      avatarUrl: "https://signed/1",
    });
  });
});
