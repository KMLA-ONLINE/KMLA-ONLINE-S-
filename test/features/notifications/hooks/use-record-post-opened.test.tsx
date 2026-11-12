import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { loadGroupNewPostCounts, markPostOpened } = vi.hoisted(() => ({
  loadGroupNewPostCounts: vi.fn(),
  markPostOpened: vi.fn(),
}));

vi.mock("~/features/notifications/data/mutations", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  markPostOpened,
}));
vi.mock("~/features/groups/data/queries", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadGroupNewPostCounts,
}));

import { groupKeys, groupNewPostCountsQuery } from "~/features/groups";
import {
  notificationKeys,
  useRecordPostOpened,
} from "~/features/notifications";
import {
  getQueryClient,
  resetQueryClientForTests,
} from "~/shared/lib/query-client";

const NEW_POST = { countedAsNew: true, notificationsRead: 0 };
const NOTHING_CHANGED = { countedAsNew: false, notificationsRead: 0 };

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={getQueryClient()}>
      {children}
    </QueryClientProvider>
  );
}

function openPost(postId: string | null) {
  return renderHook(({ id }) => useRecordPostOpened(id), {
    initialProps: { id: postId },
    wrapper,
  });
}

function resolveLater<T>(value: T) {
  return new Promise<T>((resolve) => setTimeout(() => resolve(value), 30));
}

describe("recording an opened post", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadGroupNewPostCounts.mockReset();
    resetQueryClientForTests();
    markPostOpened.mockResolvedValue(NOTHING_CHANGED);
  });

  it("records the post once when its screen opens", () => {
    openPost("post-a");

    expect(markPostOpened).toHaveBeenCalledExactlyOnceWith("post-a");
  });

  // 댓글·반응 제출이나 다른 화면의 동작이 상세 데이터를 다시 읽어도 새로 연 것이 아니다.
  // 다시 보내면 열어 두지 않은 글이나 보는 도중 온 알림까지 읽음이 된다.
  it("does not record again when the same post re-renders with fresh data", () => {
    const { rerender } = openPost("post-a");

    rerender({ id: "post-a" });

    expect(markPostOpened).toHaveBeenCalledTimes(1);
  });

  it("records each post the screen moves to", () => {
    const { rerender } = openPost("post-a");

    rerender({ id: "post-b" });

    expect(markPostOpened.mock.calls).toEqual([["post-a"], ["post-b"]]);
  });

  // 열어 둔 동안 집계로 다시 안 읽음이 된 알림은 다음에 열 때 읽는다.
  it("records the same post again when it is closed and reopened", () => {
    const { rerender } = openPost("post-a");

    rerender({ id: null });
    rerender({ id: "post-a" });

    expect(markPostOpened).toHaveBeenCalledTimes(2);
  });

  it("records nothing while no post is shown", () => {
    openPost(null);

    expect(markPostOpened).not.toHaveBeenCalled();
  });

  it("re-reads the server count without a mounted screen once recorded", async () => {
    markPostOpened.mockResolvedValue(NEW_POST);
    const queryClient = getQueryClient();
    loadGroupNewPostCounts.mockResolvedValueOnce({ "group-id": 2 });
    await queryClient.query(groupNewPostCountsQuery());
    // 서버 값이 이미 이 글을 뺐으면 하나 더 내려가지 않는다.
    loadGroupNewPostCounts.mockResolvedValue({ "group-id": 1 });

    openPost("post-a");

    await vi.waitFor(() =>
      expect(queryClient.getQueryData(groupKeys.newPostCounts())).toEqual({
        "group-id": 1,
      }),
    );
    expect(loadGroupNewPostCounts).toHaveBeenCalledTimes(2);
  });

  it("replaces a refetch already in flight so its older value cannot land", async () => {
    markPostOpened.mockResolvedValue(NEW_POST);
    const queryClient = getQueryClient();
    loadGroupNewPostCounts.mockResolvedValueOnce({ "group-id": 2 });
    await queryClient.query(groupNewPostCountsQuery());
    // 알림을 열며 시작한 재조회가 기록 전의 값을 늦게 돌려준다.
    loadGroupNewPostCounts.mockImplementationOnce(() =>
      resolveLater({ "group-id": 2 }),
    );
    loadGroupNewPostCounts.mockResolvedValue({ "group-id": 1 });
    void queryClient.refetchQueries({ queryKey: groupKeys.newPostCounts() });

    openPost("post-a");
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(queryClient.getQueryData(groupKeys.newPostCounts())).toEqual({
      "group-id": 1,
    });
  });

  it("does not fail a first count load the group home is waiting on", async () => {
    markPostOpened.mockResolvedValue(NEW_POST);
    const queryClient = getQueryClient();
    loadGroupNewPostCounts.mockImplementationOnce(() =>
      resolveLater({ "group-id": 1 }),
    );
    const firstLoad = queryClient.query(groupNewPostCountsQuery());

    openPost("post-a");

    await expect(firstLoad).resolves.toEqual({ "group-id": 1 });
  });

  it("leaves the count alone for a post that was not new", async () => {
    const queryClient = getQueryClient();
    queryClient.setQueryData(groupKeys.newPostCounts(), { "group-id": 2 });

    openPost("post-a");
    await vi.waitFor(() => expect(markPostOpened).toHaveBeenCalled());
    await Promise.resolve();

    expect(queryClient.getQueryData(groupKeys.newPostCounts())).toEqual({
      "group-id": 2,
    });
    expect(
      queryClient.getQueryState(groupKeys.newPostCounts())?.isInvalidated,
    ).toBe(false);
  });

  it("re-reads the counts and the badge when the record fails", async () => {
    markPostOpened.mockRejectedValue(new Error("offline"));
    const queryClient = getQueryClient();
    queryClient.setQueryData(groupKeys.newPostCounts(), { "group-id": 2 });
    queryClient.setQueryData(notificationKeys.badge(), 3);

    openPost("post-a");

    await vi.waitFor(() => {
      expect(
        queryClient.getQueryState(groupKeys.newPostCounts())?.isInvalidated,
      ).toBe(true);
      expect(
        queryClient.getQueryState(notificationKeys.badge())?.isInvalidated,
      ).toBe(true);
    });
  });

  it("re-reads the notification badge once the post's notifications were read", async () => {
    markPostOpened.mockResolvedValue({
      countedAsNew: false,
      notificationsRead: 2,
    });
    const queryClient = getQueryClient();
    queryClient.setQueryData(notificationKeys.badge(), 3);

    openPost("post-a");

    await vi.waitFor(() =>
      expect(
        queryClient.getQueryState(notificationKeys.badge())?.isInvalidated,
      ).toBe(true),
    );
  });

  it("leaves the badge alone when no notification was read", async () => {
    const queryClient = getQueryClient();
    queryClient.setQueryData(notificationKeys.badge(), 3);

    openPost("post-a");
    await vi.waitFor(() => expect(markPostOpened).toHaveBeenCalled());
    await Promise.resolve();

    expect(
      queryClient.getQueryState(notificationKeys.badge())?.isInvalidated,
    ).toBe(false);
  });
});
