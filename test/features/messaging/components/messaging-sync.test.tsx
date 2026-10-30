import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { act, render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MessagingSync } from "~/features/messaging/components/messaging-sync";
import { messagingKeys } from "~/features/messaging/data/cache";
import type {
  MessagingSignalHandlers,
  RoomSignalHandlers,
} from "~/features/messaging/data/subscriptions";
import * as sync from "~/features/messaging/data/sync";

let handlers: MessagingSignalHandlers;
/** 지금 구독 중인 대화방 topic과 그 핸들러. */
const rooms = new Map<string, RoomSignalHandlers>();

vi.mock("~/features/messaging/data/subscriptions", () => ({
  subscribeToMessagingSignals: (
    _profileId: number,
    next: MessagingSignalHandlers,
  ) => {
    handlers = next;
    return () => undefined;
  },
  subscribeToRoomSignals: (
    conversationId: string,
    _profileId: number,
    next: RoomSignalHandlers,
  ) => {
    rooms.set(conversationId, next);
    return () => rooms.delete(conversationId);
  },
}));

function room(id: string): RoomSignalHandlers {
  const subscribed = rooms.get(id);
  if (!subscribed) throw new Error(`room ${id} is not subscribed`);
  return subscribed;
}
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
  rooms.clear();
  vi.useRealTimers();
  vi.mocked(sync.catchUpConversation).mockClear();
  vi.mocked(sync.refreshReadState).mockClear();
  vi.mocked(sync.refreshConversationInList).mockClear();
});

function renderSync() {
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const tree = (openRoom: boolean) => (
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        {openRoom && <OpenRoom id="open" />}
        <MessagingSync profileId={1} />
      </QueryClientProvider>
    </MemoryRouter>
  );
  const view = render(tree(true));
  return {
    invalidate,
    queryClient,
    closeRoom: () => view.rerender(tree(false)),
  };
}

/** 방이 열릴 때의 따라잡기를 끝내고 호출 기록을 비운다. */
async function settleOpenedRoom() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
  vi.mocked(sync.catchUpConversation).mockClear();
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

  it("그룹에서는 첫 읽음을 바로 받고 뒤따르는 읽음은 1초 간격으로 모은다", async () => {
    renderSync();
    await settleOpenedRoom();

    act(() => {
      room("open").onReadChanged();
      room("open").onReadChanged();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(sync.refreshReadState).toHaveBeenCalledTimes(1);
    expect(sync.refreshReadState).toHaveBeenCalledWith(
      expect.anything(),
      "open",
    );

    act(() => {
      room("open").onReadChanged();
      room("open").onReadChanged();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(sync.refreshReadState).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(sync.refreshReadState).toHaveBeenCalledTimes(2);
    expect(sync.catchUpConversation).not.toHaveBeenCalled();
  });

  it("그룹에서 읽음을 받는 중에 온 읽음도 1초 간격을 지킨다", async () => {
    let finish = () => undefined as void;
    vi.mocked(sync.refreshReadState).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    renderSync();
    await settleOpenedRoom();

    act(() => room("open").onReadChanged());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    act(() => room("open").onReadChanged());
    await act(async () => {
      finish();
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(sync.refreshReadState).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(sync.refreshReadState).toHaveBeenCalledTimes(2);
  });

  it("1:1에서는 연달아 읽어도 1초를 기다리지 않는다", async () => {
    const { queryClient } = renderSync();
    queryClient.setQueryData(messagingKeys.conversations(), [
      { id: "open", type: "direct" },
    ]);
    await settleOpenedRoom();

    for (const times of [1, 2]) {
      act(() => room("open").onReadChanged());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(sync.refreshReadState).toHaveBeenCalledTimes(times);
    }
  });

  it("읽음을 기다리는 중에 온 새 메시지는 읽음 간격만큼 늦추지 않는다", async () => {
    renderSync();

    act(() => room("open").onReadChanged());
    act(() => handlers.onMessageChanged("open", "content"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(sync.catchUpConversation).toHaveBeenCalledTimes(1);
    expect(sync.refreshReadState).toHaveBeenCalledTimes(1);
  });

  it("화면으로 돌아와도 30초 안에 이미 맞췄으면 다시 읽지 않는다", async () => {
    const { invalidate } = renderSync();
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("visible");
    const resume = () => document.dispatchEvent(new Event("visibilitychange"));

    act(() => {
      resume();
    });
    const once = invalidate.mock.calls.length;
    expect(once).toBeGreaterThan(0);
    act(() => {
      resume();
    });
    expect(invalidate).toHaveBeenCalledTimes(once);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    act(() => {
      resume();
    });
    expect(invalidate).toHaveBeenCalledTimes(once * 2);
    visibility.mockRestore();
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

  it("지운 그룹은 대화 목록에서 바로 뺀다", () => {
    const { queryClient } = renderSync();
    queryClient.setQueryData(messagingKeys.conversations(), [
      { id: "gone" },
      { id: "kept" },
    ]);

    act(() => handlers.onConversationDeleted("gone"));

    expect(queryClient.getQueryData(messagingKeys.conversations())).toEqual([
      { id: "kept" },
    ]);
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
    );
  });

  it("열린 대화방만 읽음 topic을 구독하고, 방을 닫으면 구독을 끊는다", async () => {
    const { closeRoom } = renderSync();

    expect([...rooms.keys()]).toEqual(["open"]);

    closeRoom();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(rooms.size).toBe(0);
  });

  it("대화방 채널이 붙으면 신호를 기다리지 않고 그 방의 읽음을 다시 받는다", async () => {
    renderSync();
    await settleOpenedRoom();

    act(() => room("open").onSubscribed());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(sync.refreshReadState).toHaveBeenCalledTimes(1);
    expect(sync.refreshReadState).toHaveBeenCalledWith(
      expect.anything(),
      "open",
    );
    expect(sync.catchUpConversation).not.toHaveBeenCalled();
  });

  it("방이 열리면 닫혀 있던 동안의 변경을 신호를 기다리지 않고 따라잡는다", async () => {
    renderSync();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(sync.catchUpConversation).toHaveBeenCalledTimes(1);
    expect(sync.catchUpConversation).toHaveBeenCalledWith(
      expect.anything(),
      "open",
    );
  });
});
