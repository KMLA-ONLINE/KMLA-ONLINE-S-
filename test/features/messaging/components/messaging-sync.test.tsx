import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MessagingSync } from "~/features/messaging/components/messaging-sync";
import { messagingKeys } from "~/features/messaging/data/cache";
import type { MessagingSignalHandlers } from "~/features/messaging/data/subscriptions";
import * as sync from "~/features/messaging/data/sync";

let handlers: MessagingSignalHandlers;

vi.mock("~/features/messaging/data/subscriptions", () => ({
  subscribeToMessagingSignals: (
    _profileId: number,
    next: MessagingSignalHandlers,
  ) => {
    handlers = next;
    return () => undefined;
  },
}));
vi.mock("~/features/messaging/data/sync", () => ({
  catchUpConversation: vi.fn(() => Promise.resolve()),
  refreshReadState: vi.fn(() => Promise.resolve()),
  refreshConversationInList: vi.fn(() => Promise.resolve()),
}));
vi.mock("~/features/messaging/data/queries", () => ({
  listConversations: vi.fn(() => Promise.resolve([])),
}));

/** 대화방 화면 대신 메시지 cache를 구독해 "열린 방"으로 만든다. */
function OpenRoom({ id }: { id: string }) {
  useQuery({
    queryKey: messagingKeys.messages(id),
    queryFn: () => ({ pages: [], pageParams: [] }),
    staleTime: Infinity,
  });
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.mocked(sync.catchUpConversation).mockClear();
  vi.mocked(sync.refreshReadState).mockClear();
  vi.mocked(sync.refreshConversationInList).mockClear();
});

function renderSync() {
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  render(
    <QueryClientProvider client={queryClient}>
      <OpenRoom id="open" />
      <MessagingSync profileId={1} />
    </QueryClientProvider>,
  );
  return { invalidate };
}

describe("MessagingSync", () => {
  it("한 변경의 여러 신호를 모아 열린 방만 한 번 따라잡고 목록에서는 바뀐 대화만 다시 받는다", async () => {
    const { invalidate } = renderSync();

    act(() => {
      handlers.onMessageChanged("open", "content");
      handlers.onMessageChanged("open", "meta");
      handlers.onMessageChanged("closed", "content");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(sync.catchUpConversation).toHaveBeenCalledTimes(1);
    expect(sync.catchUpConversation).toHaveBeenCalledWith(
      expect.anything(),
      "open",
    );
    expect(sync.refreshConversationInList).toHaveBeenCalledTimes(2);
    expect(sync.refreshConversationInList).toHaveBeenCalledWith(
      expect.anything(),
      "open",
    );
    expect(sync.refreshConversationInList).toHaveBeenCalledWith(
      expect.anything(),
      "closed",
    );
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("다른 멤버가 읽으면 열린 방의 읽음 상태를 다시 받는다", async () => {
    renderSync();

    act(() => handlers.onReadChanged("open"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(sync.refreshReadState).toHaveBeenCalledWith(
      expect.anything(),
      "open",
      "1",
    );
    expect(sync.catchUpConversation).not.toHaveBeenCalled();
  });

  it("반응·고정 신호는 열린 방만 따라잡고 대화 목록은 다시 읽지 않는다", async () => {
    const { invalidate } = renderSync();

    act(() => handlers.onMessageChanged("open", "meta"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(sync.catchUpConversation).toHaveBeenCalledTimes(1);
    expect(sync.refreshConversationInList).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("따라잡기가 실패하면 간격을 두고 다시 시도한다", async () => {
    vi.mocked(sync.catchUpConversation)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce();
    renderSync();

    act(() => handlers.onMessageChanged("open", "meta"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(sync.catchUpConversation).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(sync.catchUpConversation).toHaveBeenCalledTimes(2);
  });

  it("채널이 붙으면 처음이라도 신호를 기다리지 않고 열린 방의 변경과 읽음을 함께 맞춘다", async () => {
    renderSync();

    act(() => handlers.onSubscribed());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(sync.catchUpConversation).toHaveBeenCalledWith(
      expect.anything(),
      "open",
    );
    expect(sync.refreshReadState).toHaveBeenCalledWith(
      expect.anything(),
      "open",
      "1",
    );
  });
});
