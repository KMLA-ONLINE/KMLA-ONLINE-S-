import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as mutations from "~/features/messaging/data/mutations";
import * as queries from "~/features/messaging/data/queries";
import { loadConversation } from "~/features/messaging/data/queries";
import { messagingKeys } from "~/features/messaging/data/cache";
import { useConversationMessages } from "~/features/messaging/hooks/use-conversation-messages";
import { resetFakeMessaging } from "../fake-api";

vi.mock("~/features/messaging/data/queries", () => import("../fake-api"));

// 테스트가 고친 목 데이터(읽음, 알림 끄기, 멤버)가 다음 테스트로 새지 않게 한다.
afterEach(() => resetFakeMessaging());
vi.mock("~/features/messaging/data/mutations", () => import("../fake-api"));

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("~/features/messaging/data/files", () => ({
  prepareAttachment: vi.fn((file: File) =>
    Promise.resolve({
      kind: "file",
      file,
      thumbnail: null,
      fileName: file.name,
      width: null,
      height: null,
    }),
  ),
  uploadAttachments: vi.fn(
    (
      _conversationId: string,
      messageId: string,
      prepared: { fileName: string }[],
    ) =>
      Promise.resolve(
        prepared.map((item, index) => ({
          id: `${messageId}-a${index}`,
          kind: "file",
          mimeType: "application/pdf",
          sizeBytes: 1,
          width: null,
          height: null,
          fileName: item.fileName,
          objectPath: `c/${messageId}-${index}`,
          thumbnailPath: null,
        })),
      ),
  ),
}));

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
  it("별명이 바뀌면 오래된 답장 인용을 갱신하고 전송 중 메시지는 유지한다", async () => {
    const loaded = (await loadConversation("student-council"))!;
    const reply = {
      ...loaded.messages[0],
      id: "old-reply",
      replyTo: { id: "unloaded-original", senderId: "1", body: "@홍길동 확인" },
    };
    const pending = {
      ...loaded.messages[0],
      id: "pending",
      pending: true,
      body: "보내는 중",
    };
    const conversation = {
      ...loaded,
      messages: [reply, pending],
      pinnedMessages: [reply],
    };
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    vi.spyOn(queries, "listMessages").mockResolvedValue({
      messages: [
        { ...reply, replyTo: { ...reply.replyTo, body: "@길동이 확인" } },
      ],
      olderCursor: null,
    });
    vi.spyOn(queries, "listPinnedMessages").mockResolvedValue([
      { ...reply, replyTo: { ...reply.replyTo, body: "@길동이 확인" } },
    ]);
    const { result, rerender } = renderHook(
      ({ room }) => useConversationMessages(room),
      { wrapper, initialProps: { room: conversation } },
    );
    rerender({
      room: {
        ...conversation,
        participants: conversation.participants.map((p) => ({
          ...p,
          name: "길동이",
        })),
      },
    });
    await waitFor(() =>
      expect(
        result.current.messages.find((m) => m.id === "old-reply")?.replyTo
          ?.body,
      ).toBe("@길동이 확인"),
    );
    expect(result.current.pinnedMessages[0].replyTo?.body).toBe("@길동이 확인");
    expect(
      result.current.messages.find((m) => m.id === "pending"),
    ).toMatchObject({ pending: true, body: "보내는 중" });
  });

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

  it("보낸 메시지를 먼저 붙여 전송 중으로 표시하고, 서버가 확정하면 정본으로 바꾼다", async () => {
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
      sending = result.current.send({
        id: "new",
        body: "안녕",
        replyTo: { id: "m9", senderId: "seo", body: "원문" },
      });
    });
    await waitFor(() =>
      expect(result.current.messages.at(-1)).toMatchObject({
        id: "new",
        body: "안녕",
        senderId: "viewer",
        replyTo: { id: "m9", senderId: "seo", body: "원문" },
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

  it("이미 읽은 방이면 읽음을 기록해도 대화 목록을 다시 읽지 않고, 읽음이 옮겨졌으면 다시 읽는다", async () => {
    const conversation = (await loadConversation("student-council"))!;
    const summary = vi.spyOn(queries, "getConversationSummary");
    const markRead = vi
      .spyOn(mutations, "markConversationRead")
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const render = () => {
      const queryClient = new QueryClient();
      queryClient.setQueryData(messagingKeys.conversations(), [
        { id: "student-council", unreadCount: 0 },
      ]);
      return renderHook(() => useConversationMessages(conversation), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={queryClient}>
            {children}
          </QueryClientProvider>
        ),
      });
    };

    const { unmount } = render();
    await waitFor(() => expect(markRead).toHaveBeenCalledTimes(1));
    await act(async () => {
      await Promise.resolve();
    });
    expect(summary).not.toHaveBeenCalled();
    unmount();

    render();
    await waitFor(() => expect(markRead).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(summary).toHaveBeenCalledWith("student-council"),
    );
  });

  it("보내지 못한 메시지는 목록에 남고, 다시 보내면 같은 ID로 확정되며, 지우면 사라진다", async () => {
    const sendSpy = vi
      .spyOn(mutations, "sendMessage")
      .mockRejectedValueOnce(new Error("timeout"));
    const { result } = await renderMessages();

    let sent: boolean | undefined;
    await act(async () => {
      sent = await result.current.send({ id: "lost", body: "다시 보낼 글" });
    });
    expect(sent).toBe(false);
    await waitFor(() =>
      expect(result.current.messages.at(-1)).toMatchObject({
        id: "lost",
        failed: true,
        pending: false,
      }),
    );

    act(() => result.current.retry(result.current.messages.at(-1)!));
    await waitFor(() =>
      expect(result.current.messages.at(-1)).toMatchObject({
        id: "lost",
        failed: false,
        pending: false,
      }),
    );
    expect(sendSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "lost", body: "다시 보낼 글" }),
      expect.anything(),
    );

    sendSpy.mockRejectedValueOnce(new Error("timeout"));
    await act(async () => {
      await result.current.send({ id: "drop", body: "지울 글" });
    });
    act(() => result.current.discard(result.current.messages.at(-1)!));
    await waitFor(() =>
      expect(result.current.messages.some(({ id }) => id === "drop")).toBe(
        false,
      ),
    );
  });

  it("아직 불러오지 않은 메시지로 가면 그 메시지가 들 때까지 앞선 페이지를 이어 읽는다", async () => {
    const conversation = (await loadConversation("student-council", 3))!;
    const { result } = renderHook(() => useConversationMessages(conversation), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={new QueryClient()}>
          {children}
        </QueryClientProvider>
      ),
    });
    expect(result.current.messages.some(({ id }) => id === "m2")).toBe(false);

    let found: boolean | undefined;
    await act(async () => {
      found = await result.current.loadUntil("m2");
    });

    expect(found).toBe(true);
    await waitFor(() =>
      expect(result.current.messages.some(({ id }) => id === "m2")).toBe(true),
    );

    await act(async () => {
      found = await result.current.loadUntil("no-such-message");
    });
    expect(found).toBe(false);
  });

  it("파일은 파일마다 메시지 하나로 보내고, 업로드에 실패하면 다시 보낼 수 있게 남긴다", async () => {
    const attachments = await import("~/features/messaging/data/files");
    vi.mocked(attachments.uploadAttachments).mockRejectedValueOnce(
      new Error("offline"),
    );
    const { result } = await renderMessages();
    const before = result.current.messages.length;

    let sent: boolean | undefined;
    await act(async () => {
      sent = await result.current.sendFiles([
        new File(["a"], "a.pdf", { type: "application/pdf" }),
        new File(["b"], "b.pdf", { type: "application/pdf" }),
      ]);
    });

    expect(sent).toBe(false);
    await waitFor(() =>
      expect(result.current.messages).toHaveLength(before + 2),
    );
    // 두 메시지가 같은 밀리초에 만들어지면 순서가 ID로 갈리므로 파일 이름으로 찾는다.
    const sentFile = (name: string) =>
      result.current.messages.find(
        (message) => message.attachments?.[0]?.fileName === name,
      )!;
    const failed = sentFile("a.pdf");
    expect(failed).toMatchObject({ failed: true, body: "" });
    expect(sentFile("b.pdf")).toMatchObject({ pending: false, failed: false });

    act(() => result.current.retry(failed));
    await waitFor(() =>
      expect(
        result.current.messages.find(({ id }) => id === failed.id),
      ).toMatchObject({ failed: false, pending: false }),
    );
  });

  it("사진 묶음에서 일부만 변환에 실패하면 그 사진만 빼고 알린 뒤 나머지를 보낸다", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
    vi.spyOn(URL, "revokeObjectURL").mockReturnValue(undefined);
    const attachments = await import("~/features/messaging/data/files");
    const photo = (file: File) =>
      Promise.resolve({
        kind: "image" as const,
        file,
        thumbnail: null,
        fileName: file.name,
        width: 10,
        height: 10,
      });
    vi.mocked(attachments.prepareAttachment)
      .mockImplementationOnce(photo)
      .mockRejectedValueOnce(new Error("decode failed"))
      .mockImplementationOnce(photo);
    const { result } = await renderMessages();

    let sent: boolean | undefined;
    await act(async () => {
      sent = await result.current.sendFiles([
        new File(["a"], "a.jpg", { type: "image/jpeg" }),
        new File(["b"], "broken.jpg", { type: "image/jpeg" }),
        new File(["c"], "c.jpg", { type: "image/jpeg" }),
      ]);
    });

    expect(sent).toBe(true);
    expect(toast.error).toHaveBeenCalledWith(
      "사진 한 장은 보내지 못했습니다: broken.jpg",
    );
    expect(vi.mocked(attachments.uploadAttachments)).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.any(String),
      [
        expect.objectContaining({ fileName: "a.jpg" }),
        expect.objectContaining({ fileName: "c.jpg" }),
      ],
    );
    // cache 알림은 다음 tick에 묶여 나간다.
    await waitFor(() =>
      expect(
        result.current.messages.find(
          (message) => message.attachments?.[0]?.fileName === "a.jpg",
        ),
      ).toMatchObject({ pending: false, failed: false }),
    );
    const photoMessage = result.current.messages.find(
      (message) => message.attachments?.[0]?.fileName === "a.jpg",
    )!;
    expect(photoMessage.attachments?.map(({ fileName }) => fileName)).toEqual([
      "a.jpg",
      "c.jpg",
    ]);
  });

  it("앞선 전송이 응답만 잃었으면 다시 보낼 때 다시 올리지 않고 보낸 것으로 확정한다", async () => {
    const files = await import("~/features/messaging/data/files");
    vi.mocked(files.uploadAttachments).mockRejectedValueOnce(
      Object.assign(new Error("message already sent"), { code: "23505" }),
    );
    const { result } = await renderMessages();

    let sent: boolean | undefined;
    await act(async () => {
      sent = await result.current.sendFiles([
        new File(["a"], "a.pdf", { type: "application/pdf" }),
      ]);
    });

    expect(sent).toBe(true);
    await waitFor(() =>
      expect(result.current.messages.at(-1)).toMatchObject({
        pending: false,
        failed: false,
      }),
    );
  });
});
