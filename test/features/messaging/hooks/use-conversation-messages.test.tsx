import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as mutations from "~/features/messaging/data/mutations";
import { loadConversation } from "~/features/messaging/data/queries";
import { useConversationMessages } from "~/features/messaging/hooks/use-conversation-messages";

vi.mock("~/features/messaging/data/queries", () => import("../fake-api"));
vi.mock("~/features/messaging/data/mutations", () => import("../fake-api"));

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

async function renderMessages() {
  const conversation = (await loadConversation("student-council"))!;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => useConversationMessages(conversation), { wrapper });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useConversationMessages", () => {
  it("가려진 탭에서는 읽음을 기록하지 않고 다시 보일 때 가장 최근 상대 메시지까지 기록한다", async () => {
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
    const markRead = vi.spyOn(mutations, "markConversationRead");
    await renderMessages();

    expect(markRead).not.toHaveBeenCalled();

    visibility.mockReturnValue("visible");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() =>
      expect(markRead).toHaveBeenCalledWith("student-council", "m9"),
    );
    expect(markRead).toHaveBeenCalledTimes(1);
  });

  it("보낸 메시지를 먼저 붙이고 정본으로 확정한다", async () => {
    const { result } = await renderMessages();

    let sent: boolean | undefined;
    await act(async () => {
      sent = await result.current.send({
        body: "안녕",
        replyTo: { id: "m9", senderId: "seo", body: "원문" },
      });
    });

    expect(sent).toBe(true);
    // cache 알림은 다음 tick에 묶여 나간다.
    await waitFor(() =>
      expect(result.current.messages.at(-1)).toMatchObject({
        body: "안녕",
        senderId: "viewer",
        replyTo: { id: "m9", senderId: "seo", body: "원문" },
      }),
    );
  });

  it("전송이 실패하면 먼저 붙인 메시지를 거두고 false로 끝난다", async () => {
    vi.spyOn(mutations, "sendMessage").mockRejectedValue(new Error("offline"));
    const { result } = await renderMessages();
    const before = result.current.messages.length;

    let sent: boolean | undefined;
    await act(async () => {
      sent = await result.current.send({ body: "안녕" });
    });

    expect(sent).toBe(false);
    expect(result.current.messages).toHaveLength(before);
  });

  it("같은 반응을 다시 고르면 지우고, 실패하면 직전 반응으로 되돌린다", async () => {
    const { result } = await renderMessages();
    const target = () => result.current.messages.find(({ id }) => id === "m3")!;

    act(() => result.current.react(target(), "love"));
    await waitFor(() => expect(target().myReaction).toBe("love"));
    expect(target().reactions).toContainEqual({ reaction: "love", count: 1 });

    act(() => result.current.react(target(), "love"));
    await waitFor(() => expect(target().myReaction).toBeNull());

    vi.spyOn(mutations, "setMessageReaction").mockRejectedValue(
      new Error("offline"),
    );
    act(() => result.current.react(target(), "haha"));
    await waitFor(() => expect(target().myReaction).toBeNull());
    expect(target().reactions).toEqual([{ reaction: "like", count: 3 }]);
  });

  it("같은 메시지에 반응이 겹치면 먼저 보낸 요청의 응답이 나중 선택을 덮지 않는다", async () => {
    let resolveFirst!: () => void;
    const spy = vi
      .spyOn(mutations, "setMessageReaction")
      .mockImplementationOnce(
        (message, reaction) =>
          new Promise((resolve) => {
            resolveFirst = () =>
              resolve({
                reactions: [{ reaction: reaction!, count: 1 }],
                myReaction: reaction,
              });
          }),
      );
    const { result } = await renderMessages();
    const target = () => result.current.messages.find(({ id }) => id === "m2")!;

    act(() => result.current.react(target(), "love"));
    await waitFor(() => expect(target().myReaction).toBe("love"));
    act(() => result.current.react(target(), "haha"));
    await waitFor(() => expect(target().myReaction).toBe("haha"));

    await act(async () => {
      resolveFirst();
      await Promise.resolve();
    });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    expect(target().myReaction).toBe("haha");
    expect(target().reactions).toEqual([{ reaction: "haha", count: 1 }]);
  });

  it("고정과 해제를 고정 메시지 목록에도 대화 순서대로 반영한다", async () => {
    const { result } = await renderMessages();
    const ids = () => result.current.pinnedMessages.map(({ id }) => id);
    const message = (id: string) =>
      result.current.messages.find((item) => item.id === id)!;

    expect(ids()).toEqual(["m5"]);
    act(() => result.current.togglePinned(message("m8")));
    act(() => result.current.togglePinned(message("m2")));
    await waitFor(() => expect(ids()).toEqual(["m2", "m5", "m8"]));

    act(() => result.current.togglePinned(message("m5")));
    await waitFor(() => expect(ids()).toEqual(["m2", "m8"]));
  });
});
