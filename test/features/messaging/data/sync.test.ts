import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  holdMessageWrite,
  markConversationListRead,
  mergeServerMessages,
  patchMessage,
  messagingKeys,
  type MessagePages,
} from "~/features/messaging/data/cache";
import * as queries from "~/features/messaging/data/queries";
import {
  catchUpConversation,
  refreshReadState,
} from "~/features/messaging/data/sync";
import type { ConversationMessage } from "~/features/messaging/model/types";

vi.mock("~/features/messaging/data/queries", () => ({
  listMessageChanges: vi.fn(),
  listMessageReadCounts: vi.fn(),
  listMessages: vi.fn(),
  listPinnedMessages: vi.fn(),
}));

const ID = "conversation";

function message(
  id: string,
  minute: number,
  extra: Partial<ConversationMessage> = {},
): ConversationMessage {
  const at = `2026-08-28T06:${String(minute).padStart(2, "0")}:00.000Z`;
  return { id, senderId: "1", body: id, sentAt: at, changedAt: at, ...extra };
}

function seed(
  queryClient: QueryClient,
  pages: ConversationMessage[][],
  pinned: ConversationMessage[] = [],
) {
  queryClient.setQueryData<MessagePages>(messagingKeys.messages(ID), {
    pages: pages.map((messages) => ({ messages, olderCursor: null })),
    pageParams: pages.map(() => null),
  });
  queryClient.setQueryData(messagingKeys.pinned(ID), pinned);
}

function pageIds(queryClient: QueryClient) {
  return queryClient
    .getQueryData<MessagePages>(messagingKeys.messages(ID))!
    .pages.map((page) => page.messages.map(({ id }) => id));
}

let queryClient: QueryClient;

beforeEach(() => {
  queryClient = new QueryClient();
  vi.mocked(queries.listMessageChanges).mockReset();
  vi.mocked(queries.listMessages).mockReset();
  vi.mocked(queries.listPinnedMessages).mockReset();
  vi.mocked(queries.listMessageReadCounts).mockReset();
});

describe("mergeServerMessages", () => {
  it("불러온 메시지는 덮고, 불러온 구간 안의 새 메시지는 그 페이지에 순서대로 넣고, 그보다 앞선 메시지는 두지 않는다", () => {
    // 최신 페이지는 c·e, 앞선 페이지는 a. 그 앞은 아직 불러오지 않았다.
    queryClient.setQueryData<MessagePages>(messagingKeys.messages(ID), {
      pages: [
        { messages: [message("c", 3), message("e", 5)], olderCursor: null },
        {
          messages: [message("b", 2)],
          olderCursor: { sentAt: "2026-08-28T06:02:00.000Z", id: "b" },
        },
      ],
      pageParams: [null, null],
    });

    mergeServerMessages(queryClient, ID, [
      message("f", 6),
      message("b", 2, { body: "고친 b" }),
      message("d", 4),
      message("a", 1),
    ]);

    // d는 가장 최근 메시지(e)보다 앞서지만 불러온 구간 안이라 들어간다. a는 불러오지 않은 구간이다.
    expect(pageIds(queryClient)).toEqual([["c", "d", "e", "f"], ["b"]]);
    expect(
      queryClient.getQueryData<MessagePages>(messagingKeys.messages(ID))!
        .pages[1].messages[0].body,
    ).toBe("고친 b");
  });

  it("대화의 처음까지 불러왔으면 가장 오래된 페이지 앞의 메시지도 넣는다", () => {
    seed(queryClient, [[message("c", 3)]]);

    mergeServerMessages(queryClient, ID, [message("a", 1)]);

    expect(pageIds(queryClient)).toEqual([["a", "c"]]);
  });

  it("내 요청이 진행 중이거나 cache보다 낡은 서버 행은 덮지 않는다", () => {
    seed(queryClient, [
      [
        message("a", 1, {
          myReaction: "love",
          changedAt: "2026-08-28T07:00:00Z",
        }),
        message("b", 2, { myReaction: "love" }),
      ],
    ]);
    const release = holdMessageWrite("b");

    mergeServerMessages(queryClient, ID, [
      message("a", 1, { myReaction: null, changedAt: "2026-08-28T06:30:00Z" }),
      message("b", 2, { myReaction: null }),
    ]);
    release();

    const [page] = queryClient.getQueryData<MessagePages>(
      messagingKeys.messages(ID),
    )!.pages;
    expect(page.messages.map(({ myReaction }) => myReaction)).toEqual([
      "love",
      "love",
    ]);
  });

  it("원문이 바뀌거나 지워지면 인용한 답장의 인용도 고친다", () => {
    seed(queryClient, [
      [
        message("a", 1),
        message("b", 2, { replyTo: { id: "a", senderId: "1", body: "a" } }),
      ],
    ]);

    mergeServerMessages(queryClient, ID, [
      message("a", 1, { body: "", deleted: true }),
    ]);

    expect(
      queryClient.getQueryData<MessagePages>(messagingKeys.messages(ID))!
        .pages[0].messages[1].replyTo,
    ).toEqual({
      id: "a",
      senderId: "1",
      body: "",
      deleted: true,
      attachmentKind: null,
    });
  });

  it("고정 목록은 행의 고정 상태대로 넣고 빼며 대화 순서를 지킨다", () => {
    seed(queryClient, [[message("c", 3)]], [message("a", 1, { pinned: true })]);

    mergeServerMessages(queryClient, ID, [
      message("a", 1, { pinned: false }),
      message("b", 2, { pinned: true }),
      message("c", 3, { pinned: true }),
    ]);

    expect(
      queryClient
        .getQueryData<ConversationMessage[]>(messagingKeys.pinned(ID))!
        .map(({ id }) => id),
    ).toEqual(["b", "c"]);
  });
});

describe("catchUpConversation", () => {
  it("마지막으로 본 변경 이후만 받아 합친다", async () => {
    seed(queryClient, [
      [message("a", 1), message("b", 2, { changedAt: "2026-08-28T07:00:00Z" })],
    ]);
    vi.mocked(queries.listMessageChanges).mockResolvedValue({
      messages: [message("c", 3)],
      complete: true,
    });

    await catchUpConversation(queryClient, ID);

    expect(queries.listMessageChanges).toHaveBeenCalledWith(
      ID,
      "2026-08-28T07:00:00Z",
    );
    expect(pageIds(queryClient)).toEqual([["a", "b", "c"]]);
  });

  it("바뀐 메시지가 한 번에 받을 수를 넘으면 최신 페이지부터 다시 읽고, 앞선 페이지는 버리되 전송 중인 내 메시지는 남긴다", async () => {
    seed(queryClient, [
      [message("c", 3), message("draft", 10, { pending: true })],
      [message("a", 1)],
    ]);
    vi.mocked(queries.listMessageChanges).mockResolvedValue({
      messages: [],
      complete: false,
    });
    vi.mocked(queries.listMessages).mockResolvedValue({
      messages: [message("x", 9)],
      olderCursor: { sentAt: "2026-08-28T06:09:00.000Z", id: "x" },
    });
    vi.mocked(queries.listPinnedMessages).mockResolvedValue([]);

    await catchUpConversation(queryClient, ID);

    expect(pageIds(queryClient)).toEqual([["x", "draft"]]);
  });

  it("기준이 없는 빈 방도 따라잡기로 받고 전송 중인 내 메시지를 버리지 않는다", async () => {
    seed(queryClient, [
      [message("draft", 1, { pending: true, changedAt: undefined })],
    ]);
    vi.mocked(queries.listMessageChanges).mockResolvedValue({
      messages: [message("a", 0)],
      complete: true,
    });

    await catchUpConversation(queryClient, ID);

    expect(queries.listMessageChanges).toHaveBeenCalledWith(
      ID,
      "1970-01-01T00:00:00Z",
    );
    expect(pageIds(queryClient)).toEqual([["a", "draft"]]);
  });
});

describe("refreshReadState", () => {
  it("보낸 메시지의 읽지 않은 수를 받아 고친다", async () => {
    seed(queryClient, [
      [
        message("mine", 1, { unreadMemberCount: 2 }),
        message("other", 2, { senderId: "2" }),
        message("sending", 3, { pending: true }),
        message("gone", 4, { deleted: true }),
      ],
    ]);
    vi.mocked(queries.listMessageReadCounts).mockResolvedValue(
      new Map([["mine", 0]]),
    );

    await refreshReadState(queryClient, ID);

    expect(queries.listMessageReadCounts).toHaveBeenCalledWith(ID, [
      "mine",
      "other",
    ]);
    expect(
      queryClient.getQueryData<MessagePages>(messagingKeys.messages(ID))!
        .pages[0].messages[0].unreadMemberCount,
    ).toBe(0);
  });
});

describe("message order", () => {
  it("같은 밀리초 안의 메시지도 서버처럼 마이크로초로 줄 세운다", () => {
    seed(queryClient, [
      [message("z", 1, { sentAt: "2026-08-28T06:00:00.123900+00:00" })],
    ]);

    mergeServerMessages(queryClient, ID, [
      message("y", 1, { sentAt: "2026-08-28T06:00:00.123100+00:00" }),
    ]);

    expect(pageIds(queryClient)).toEqual([["y", "z"]]);
  });

  it("서버가 전송 시각을 확정하면 앞서 도착한 상대 메시지 뒤로 자리를 다시 잡는다", () => {
    // 기기 시계가 빨라 초안이 상대 메시지(06:05)보다 뒤에 붙어 있었다.
    seed(queryClient, [
      [message("other", 5), message("draft", 9, { pending: true })],
    ]);

    patchMessage(queryClient, ID, "draft", {
      sentAt: "2026-08-28T06:04:00.000Z",
      pending: false,
    });

    expect(pageIds(queryClient)).toEqual([["draft", "other"]]);
  });
});

describe("reloadLatestPage", () => {
  it("다시 읽어도 내 요청이 진행 중인 메시지는 cache의 상태를 지킨다", async () => {
    seed(queryClient, [[message("a", 1, { deleted: true, body: "" })]]);
    vi.mocked(queries.listMessageChanges).mockResolvedValue({
      messages: [],
      complete: false,
    });
    vi.mocked(queries.listMessages).mockResolvedValue({
      messages: [message("a", 1)],
      olderCursor: null,
    });
    vi.mocked(queries.listPinnedMessages).mockResolvedValue([]);
    const release = holdMessageWrite("a");

    await catchUpConversation(queryClient, ID);
    release();

    expect(
      queryClient.getQueryData<MessagePages>(messagingKeys.messages(ID))!
        .pages[0].messages[0].deleted,
    ).toBe(true);
  });
});

describe("markConversationListRead", () => {
  it("목록의 그 대화를 읽음으로 그리고 탭 배지에서 그만큼 뺀다", () => {
    queryClient.setQueryData(messagingKeys.conversations(), [
      { id: ID, unreadCount: 3 },
      { id: "other", unreadCount: 2 },
    ]);
    queryClient.setQueryData(messagingKeys.unreadCount(), 5);

    markConversationListRead(queryClient, ID);

    expect(queryClient.getQueryData(messagingKeys.unreadCount())).toBe(2);
    expect(
      queryClient.getQueryData<{ unreadCount: number }[]>(
        messagingKeys.conversations(),
      )?.[0]?.unreadCount,
    ).toBe(0);
  });
});
