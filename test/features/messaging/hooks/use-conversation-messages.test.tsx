import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as mutations from "~/features/messaging/data/mutations";
import { loadConversation } from "~/features/messaging/data/queries";
import { messagingKeys } from "~/features/messaging/data/cache";
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

  it("고친 본문을 먼저 그리고 인용한 답장도 고치며, 실패하면 되돌린다", async () => {
    const { result } = await renderMessages();
    const message = (id: string) =>
      result.current.messages.find((item) => item.id === id)!;

    await act(async () => {
      await result.current.edit(message("m7"), "고친 원문");
    });
    await waitFor(() => expect(message("m7").body).toBe("고친 원문"));
    expect(message("m7").editedAt).toEqual(expect.any(String));
    expect(message("m8").replyTo?.body).toBe("고친 원문");

    vi.spyOn(mutations, "editMessage").mockRejectedValue(new Error("offline"));
    let edited: boolean | undefined;
    await act(async () => {
      edited = await result.current.edit(message("m4"), "실패할 수정");
    });
    expect(edited).toBe(false);
    await waitFor(() => expect(message("m4").editedAt).toBeUndefined());
    expect(message("m4").body).not.toBe("실패할 수정");
  });

  it("지운 메시지는 자리를 남기고 반응과 고정을 거두며, 실패하면 되돌린다", async () => {
    const { result } = await renderMessages();
    const message = (id: string) =>
      result.current.messages.find((item) => item.id === id)!;

    act(() => result.current.remove(message("m5")));
    await waitFor(() =>
      expect(message("m5")).toMatchObject({
        deleted: true,
        body: "",
        reactions: [],
        pinned: false,
      }),
    );
    expect(result.current.pinnedMessages).toEqual([]);

    vi.spyOn(mutations, "deleteMessages").mockRejectedValue(
      new Error("offline"),
    );
    vi.mocked(toast.error).mockClear();
    const body = message("m3").body;
    act(() => result.current.remove(message("m3")));
    // 먼저 그린 삭제는 거절이 곧바로 와서 같은 tick에 되돌아간다. 최종 상태만 본다.
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(message("m3").deleted).toBeFalsy();
    expect(message("m3").body).toBe(body);
    expect(message("m3").reactions).toEqual([{ reaction: "like", count: 3 }]);
  });

  it("보낸 메시지는 서버가 확정할 때까지 전송 중으로 표시한다", async () => {
    let resolveSend!: () => void;
    vi.spyOn(mutations, "sendMessage").mockImplementationOnce(
      (input, draft) =>
        new Promise((resolve) => {
          resolveSend = () => resolve({ ...draft, id: input.id });
        }),
    );
    const { result } = await renderMessages();

    let sending!: Promise<boolean>;
    act(() => {
      sending = result.current.send({ id: "new", body: "안녕" });
    });
    await waitFor(() =>
      expect(result.current.messages.at(-1)).toMatchObject({
        id: "new",
        pending: true,
      }),
    );

    await act(async () => {
      resolveSend();
      await sending;
    });
    await waitFor(() =>
      expect(result.current.messages.at(-1)?.pending).toBe(false),
    );
  });

  it("수정 도중 같은 메시지에 반응해도 실패한 수정은 되돌린다", async () => {
    let rejectEdit!: () => void;
    vi.spyOn(mutations, "editMessage").mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectEdit = () => reject(new Error("offline"));
        }),
    );
    const { result } = await renderMessages();
    const message = () =>
      result.current.messages.find(({ id }) => id === "m4")!;
    const body = message().body;

    let editing!: Promise<boolean>;
    act(() => {
      editing = result.current.edit(message(), "고친 본문");
    });
    await waitFor(() => expect(message().body).toBe("고친 본문"));
    act(() => result.current.react(message(), "love"));
    await waitFor(() => expect(message().myReaction).toBe("love"));

    await act(async () => {
      rejectEdit();
      await editing;
    });
    await waitFor(() => expect(message().body).toBe(body));
    expect(message().myReaction).toBe("love");
  });

  it("답장 인용에는 고친 원문의 앞 200자만 담는다", async () => {
    const { result } = await renderMessages();
    const message = (id: string) =>
      result.current.messages.find((item) => item.id === id)!;

    await act(async () => {
      await result.current.edit(message("m7"), "가".repeat(300));
    });

    await waitFor(() =>
      expect(message("m8").replyTo?.body).toBe("가".repeat(200)),
    );
  });

  it("내 메시지가 마지막이어도 그 앞의 가장 최근 상대 메시지까지 읽음으로 기록하고 목록을 먼저 0으로 그린다", async () => {
    const markRead = vi.spyOn(mutations, "markConversationRead");
    const loaded = (await loadConversation("student-council"))!;
    // 상대 메시지(m9) 뒤에 내 메시지가 있다. 마지막 메시지만 보면 읽음을 기록하지 않는다.
    const conversation = {
      ...loaded,
      messages: [
        ...loaded.messages,
        {
          id: "mine",
          senderId: loaded.viewerId,
          body: "내가 마지막",
          sentAt: "2026-08-28T15:40:00+09:00",
        },
      ],
    };
    const queryClient = new QueryClient();
    queryClient.setQueryData(messagingKeys.conversations(), [
      { id: "student-council", unreadCount: 3 },
    ]);
    renderHook(() => useConversationMessages(conversation), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      ),
    });

    await waitFor(() =>
      expect(markRead).toHaveBeenCalledWith("student-council", "m9"),
    );
    expect(
      queryClient.getQueryData<{ unreadCount: number }[]>(
        messagingKeys.conversations(),
      )?.[0]?.unreadCount,
    ).toBe(0);
  });

  it("응답을 잃어 실패한 전송을 같은 내용으로 다시 보내면 같은 ID를 쓴다", async () => {
    vi.spyOn(mutations, "sendMessage").mockRejectedValueOnce(
      new Error("timeout"),
    );
    const { result } = await renderMessages();
    const id = result.current.draftIdFor("다시 보낼 글");

    await act(async () => {
      await result.current.send({ id, body: "다시 보낼 글" });
    });

    expect(result.current.draftIdFor("다시 보낼 글")).toBe(id);
    expect(result.current.draftIdFor("다른 글")).not.toBe(id);

    await act(async () => {
      await result.current.send({
        id: result.current.draftIdFor("다시 보낼 글"),
        body: "다시 보낼 글",
      });
    });
    await waitFor(() =>
      expect(
        result.current.messages.filter(({ id: messageId }) => messageId === id),
      ).toHaveLength(1),
    );
    expect(result.current.draftIdFor("다시 보낼 글")).not.toBe(id);
  });
});
