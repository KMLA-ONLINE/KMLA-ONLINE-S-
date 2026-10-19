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
  openConversation,
  refreshConversationInList,
  refreshReadState,
} from "~/features/messaging/data/sync";
import type {
  Conversation,
  ConversationMessage,
  ConversationSummary,
} from "~/features/messaging/model/types";

vi.mock("~/features/messaging/data/queries", () => ({
  getConversationSummary: vi.fn(),
  loadConversation: vi.fn(),
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
  vi.mocked(queries.loadConversation).mockReset();
  vi.mocked(queries.getConversationSummary).mockReset();
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

describe("openConversation", () => {
  const summary = {
    id: ID,
    type: "group",
    name: "학생회",
    viewerId: "1",
    participants: [],
    lastMessage: null,
    unreadCount: 0,
    notificationLevel: "all",
    canDelete: false,
  } satisfies ConversationSummary;

  it("목록과 메시지 cache가 남은 방은 서버를 기다리지 않고 최신 페이지부터 연다", async () => {
    queryClient.setQueryData(messagingKeys.conversations(), [summary]);
    const failedPhoto = message("photo", 6, {
      failed: true,
      attachments: [
        {
          id: "photo:0",
          kind: "image",
          mimeType: "image/png",
          sizeBytes: 1,
          width: null,
          height: null,
          fileName: "a.png",
          objectPath: "",
          thumbnailPath: null,
        },
      ],
    });
    const failedText = message("text", 7, { failed: true });
    seed(
      queryClient,
      [[message("c", 3), failedPhoto, failedText], [message("a", 1)]],
      [message("c", 3, { pinned: true })],
    );

    const conversation = await openConversation(queryClient, ID);

    expect(queries.loadConversation).not.toHaveBeenCalled();
    expect(conversation?.name).toBe("학생회");
    expect(conversation?.messages.map(({ id }) => id)).toEqual(["c", "text"]);
    expect(conversation?.pinnedMessages.map(({ id }) => id)).toEqual(["c"]);
    // 앞선 페이지와 다시 보낼 파일이 없는 첨부 메시지는 버리고, 다시 보낼 수 있는 글은 남긴다.
    expect(pageIds(queryClient)).toEqual([["c", "text"]]);
  });

  it("목록이나 메시지 cache가 없으면 서버에서 읽어 cache를 채운다", async () => {
    seed(queryClient, [[message("c", 3)]]);
    const loaded: Conversation = {
      ...summary,
      messages: [message("d", 4)],
      olderCursor: null,
      pinnedMessages: [],
    };
    vi.mocked(queries.loadConversation).mockResolvedValue(loaded);

    const conversation = await openConversation(queryClient, ID);

    expect(queries.loadConversation).toHaveBeenCalledWith(ID);
    expect(conversation).toBe(loaded);
    expect(pageIds(queryClient)).toEqual([["d"]]);
  });
});

describe("refreshConversationInList", () => {
  function summary(unreadCount: number): ConversationSummary {
    return {
      id: ID,
      type: "direct",
      name: "상대",
      viewerId: "1",
      participants: [],
      lastMessage: null,
      unreadCount,
      notificationLevel: "all",
      canDelete: false,
    };
  }

  it("같은 대화의 갱신이 겹치면 도는 요청 하나와 그 뒤의 요청 하나로 합친다", async () => {
    queryClient.setQueryData(messagingKeys.conversations(), [summary(3)]);
    const responses: ((value: ConversationSummary) => void)[] = [];
    vi.mocked(queries.getConversationSummary).mockImplementation(
      () => new Promise((resolve) => responses.push(resolve)),
    );

    const first = refreshConversationInList(queryClient, ID);
    // 첫 요청이 도는 동안 온 갱신들은 그 요청이 시작된 뒤의 변경일 수 있어 한 번 더 읽는다.
    const second = refreshConversationInList(queryClient, ID);
    const third = refreshConversationInList(queryClient, ID);
    expect(queries.getConversationSummary).toHaveBeenCalledTimes(1);

    responses[0]?.(summary(2));
    await first;
    await vi.waitFor(() =>
      expect(queries.getConversationSummary).toHaveBeenCalledTimes(2),
    );
    responses[1]?.(summary(0));
    await Promise.all([second, third]);

    expect(queries.getConversationSummary).toHaveBeenCalledTimes(2);
    expect(
      queryClient.getQueryData<ConversationSummary[]>(
        messagingKeys.conversations(),
      )?.[0]?.unreadCount,
    ).toBe(0);

    // 다 끝난 뒤의 갱신은 새로 읽는다.
    vi.mocked(queries.getConversationSummary).mockResolvedValue(summary(1));
    await refreshConversationInList(queryClient, ID);
    expect(queries.getConversationSummary).toHaveBeenCalledTimes(3);
  });

  it("첨부가 바뀌지 않는 갱신(읽음)은 공유된 첨부 수를 다시 읽게 하지 않는다", async () => {
    queryClient.setQueryData(messagingKeys.conversations(), [summary(1)]);
    vi.mocked(queries.getConversationSummary).mockResolvedValue(summary(0));
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const countsInvalidated = () =>
      invalidate.mock.calls.some(
        ([filters]) =>
          filters?.queryKey?.[1] ===
          messagingKeys.sharedAttachmentCounts(ID)[1],
      );

    await refreshConversationInList(queryClient, ID, {
      attachmentsChanged: false,
    });
    expect(countsInvalidated()).toBe(false);

    await refreshConversationInList(queryClient, ID);
    expect(countsInvalidated()).toBe(true);
  });
});
