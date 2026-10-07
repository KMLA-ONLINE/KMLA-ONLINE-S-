import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ loadGroupHome: vi.fn() }));

vi.mock("~/features/groups/data/queries", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadGroupHome: mocks.loadGroupHome,
}));

import { groupKeys } from "~/features/groups";
import { clientLoader, shouldRevalidate } from "~/routes/app/groups/index";
import {
  getQueryClient,
  resetQueryClientForTests,
} from "~/shared/lib/query-client";

describe("group home loader", () => {
  const fresh = [{ group_id: "fresh" }];

  beforeEach(() => {
    vi.clearAllMocks();
    resetQueryClientForTests();
    mocks.loadGroupHome.mockResolvedValue(fresh);
  });

  it("loads the list when there is no cache", async () => {
    await expect(clientLoader()).resolves.toEqual({ groups: fresh });
  });

  // 오래된 캐시는 먼저 그리고, 다시 읽기는 화면의 observer가 맡는다.
  it("renders a stale cache without waiting for a refetch", async () => {
    const cached = [{ group_id: "cached" }];
    getQueryClient().setQueryData(groupKeys.home(), cached, { updatedAt: 0 });

    await expect(clientLoader()).resolves.toEqual({ groups: cached });
    expect(mocks.loadGroupHome).not.toHaveBeenCalled();
  });

  // 무효화는 방금 내가 바꾼 것이 있다는 뜻이다. 옛 목록을 먼저 그리지 않는다.
  it("waits for fresh data after an invalidation", async () => {
    const queryClient = getQueryClient();
    queryClient.setQueryData(groupKeys.home(), [{ group_id: "cached" }]);
    await queryClient.invalidateQueries({
      queryKey: groupKeys.home(),
      refetchType: "none",
    });

    await expect(clientLoader()).resolves.toEqual({ groups: fresh });
  });
});

describe("group home revalidation", () => {
  it("does not reload data for the client-side tab", () => {
    expect(
      shouldRevalidate({
        currentUrl: new URL("https://example.com/groups?tab=official"),
        nextUrl: new URL("https://example.com/groups?tab=unofficial"),
      } as never),
    ).toBe(false);
  });

  it("allows explicit same-url refreshes", () => {
    const url = new URL("https://example.com/groups");
    expect(shouldRevalidate({ currentUrl: url, nextUrl: url } as never)).toBe(
      true,
    );
  });
});
