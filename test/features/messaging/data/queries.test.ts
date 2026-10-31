import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  listConversations,
  listMessages,
  loadConversation,
} from "~/features/messaging/data/queries";

const rpc = vi.fn();

vi.mock("~/shared/supabase/client", () => ({
  getSupabase: () => ({ rpc }),
}));
vi.mock("~/features/profiles/data/media", () => ({
  createProfileMediaUrls: () =>
    Promise.resolve(new Map([["avatars/2", "https://signed/avatars/2"]])),
}));

function messageRow(id: string, sentAt: string) {
  return {
    id,
    sender_id: 7,
    body: id,
    sent_at: sentAt,
    edited_at: null,
    deleted: false,
    reply_to_id: null,
    reply_sender_id: null,
    reply_body: null,
    reply_deleted: false,
    unread_member_count: null,
    reactions: [],
    my_reaction: null,
    pinned: false,
    changed_at: sentAt,
    system_kind: null,
    system_profile_ids: null,
    system_name: null,
    attachments: [],
    mention_profile_ids: [],
  };
}

function conversationRow(overrides: Record<string, unknown> = {}) {
  return {
    conversation_id: "c0000000-0000-0000-0000-000000000001",
    type: "direct",
    name: "김민준",
    viewer_id: 1,
    participants: [
      { id: 1, name: "홍길동", avatar_path: null, active: true },
      {
        id: 2,
        pub_id: null,
        name: "김민준",
        avatar_path: "avatars/2",
        active: false,
        withdrawn: true,
      },
    ],
    last_message_id: "m",
    last_message_sender_id: 2,
    last_message_body: "원문",
    last_message_sent_at: "2026-08-28T06:00:00+00:00",
    last_message_deleted: false,
    unread_count: 3,
    muted: false,
    notification_level: "all",
    can_delete: true,
    last_message_attachment_kind: null,
    ...overrides,
  };
}

beforeEach(() => {
  rpc.mockReset();
});

describe("messaging queries", () => {
  it("한 개 더 받은 행으로 앞선 메시지가 남았는지 알고, 남았으면 가장 오래된 행이 커서다", async () => {
    rpc.mockResolvedValue({
      data: [
        messageRow("a", "2026-08-28T06:00:00+00:00"),
        messageRow("b", "2026-08-28T06:01:00+00:00"),
        messageRow("c", "2026-08-28T06:02:00.123456+00:00"),
      ],
      error: null,
    });

    const page = await listMessages(
      "conversation",
      { sentAt: "2026-08-28T07:00:00+00:00", id: "z" },
      2,
    );

    expect(rpc).toHaveBeenCalledWith("list_messages", {
      p_conversation_id: "conversation",
      p_before_sent_at: "2026-08-28T07:00:00+00:00",
      p_before_id: "z",
      p_limit: 3,
    });
    expect(page.messages.map(({ id }) => id)).toEqual(["b", "c"]);
    expect(page.messages[0]).toMatchObject({ senderId: "7" });
    // 서버 문자열을 그대로 돌려줘야 마이크로초까지 같은 경계로 다음 페이지를 자른다.
    expect(page.olderCursor).toEqual({
      sentAt: "2026-08-28T06:01:00+00:00",
      id: "b",
    });
  });

  it("멘션 대상 프로필 ID를 참여자 ID 문자열로 바꾼다", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          ...messageRow("a", "2026-08-28T06:00:00+00:00"),
          body: "[@박서현](m:1) [@최민준](m:2) 확인",
          mention_profile_ids: [3, 4],
        },
      ],
      error: null,
    });

    const page = await listMessages("conversation", null);

    expect(page.messages[0]?.mentionProfileIds).toEqual(["3", "4"]);
  });

  it("uuid가 아닌 주소는 요청하지 않고 없는 대화로 본다", async () => {
    await expect(loadConversation("not-a-uuid")).resolves.toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("대화 목록의 프로필 ID를 문자열로, 아바타 경로를 서명 URL로 바꾼다", async () => {
    rpc.mockResolvedValue({ data: [conversationRow()], error: null });

    expect(await listConversations()).toEqual([
      {
        id: "c0000000-0000-0000-0000-000000000001",
        type: "direct",
        name: "김민준",
        viewerId: "1",
        participants: [
          {
            id: "1",
            name: "홍길동",
            profileName: "홍길동",
            nickname: null,
            avatarUrl: null,
            active: true,
            withdrawn: false,
          },
          {
            id: "2",
            name: "김민준",
            profileName: "김민준",
            nickname: null,
            avatarUrl: "https://signed/avatars/2",
            active: false,
            withdrawn: true,
          },
        ],
        lastMessage: {
          senderId: "2",
          body: "원문",
          sentAt: "2026-08-28T06:00:00+00:00",
          attachmentKind: null,
        },
        unreadCount: 3,
        notificationLevel: "all",
        canDelete: true,
      },
    ]);
  });

  it("별명이 있으면 보이는 이름으로 쓰고 프로필 이름은 따로 둔다", async () => {
    rpc.mockResolvedValue({
      data: [
        conversationRow({
          type: "group",
          participants: [
            {
              id: 1,
              pub_id: "hong",
              name: "홍길동",
              nickname: "길동이",
              avatar_path: null,
              active: true,
            },
          ],
        }),
      ],
      error: null,
    });

    const [conversation] = await listConversations();
    expect(conversation?.participants[0]).toMatchObject({
      name: "길동이",
      profileName: "홍길동",
      nickname: "길동이",
    });
  });

  it("삭제된 마지막 메시지는 삭제 문구로, 메시지가 없는 대화는 미리보기 없이 준다", async () => {
    rpc.mockResolvedValue({
      data: [
        conversationRow({
          last_message_deleted: true,
          last_message_body: null,
        }),
        conversationRow({
          conversation_id: "c0000000-0000-0000-0000-000000000002",
          last_message_id: null,
          last_message_sender_id: null,
          last_message_body: null,
          last_message_sent_at: null,
        }),
      ],
      error: null,
    });

    const [deleted, empty] = await listConversations();

    expect(deleted?.lastMessage?.body).toBe("삭제된 메시지입니다");
    expect(empty?.lastMessage).toBeNull();
  });

  it("대화방은 대화 정보와 최신 페이지를 합치고, 답장 원문을 인용으로 붙인다", async () => {
    rpc.mockImplementation((name: string) =>
      Promise.resolve(
        name === "list_conversations"
          ? { data: [conversationRow()], error: null }
          : name === "list_pinned_messages"
            ? { data: [], error: null }
            : {
                data: [
                  {
                    ...messageRow("b", "2026-08-28T06:01:00+00:00"),
                    sender_id: 1,
                    reply_to_id: "a",
                    reply_sender_id: 2,
                    reply_body: "",
                    reply_deleted: true,
                    unread_member_count: 1,
                    reactions: [{ reaction: "❤️", count: 2 }],
                    my_reaction: "❤️",
                    pinned: true,
                    edited_at: "2026-08-28T06:05:00+00:00",
                  },
                ],
                error: null,
              },
      ),
    );

    const conversation = await loadConversation(
      "c0000000-0000-0000-0000-000000000001",
    );

    expect(conversation).toMatchObject({
      viewerId: "1",
      olderCursor: null,
      pinnedMessages: [],
      messages: [
        {
          id: "b",
          senderId: "1",
          unreadMemberCount: 1,
          reactions: [{ reaction: "❤️", count: 2 }],
          myReaction: "❤️",
          pinned: true,
          editedAt: "2026-08-28T06:05:00+00:00",
          replyTo: { id: "a", senderId: "2", body: "", deleted: true },
        },
      ],
    });
  });

  it("RPC 한 번의 상한을 넘는 페이지 크기는 상한으로 줄여 남은 메시지를 놓치지 않는다", async () => {
    rpc.mockResolvedValue({ data: [], error: null });

    await listMessages("conversation", null, 500);

    expect(rpc).toHaveBeenCalledWith(
      "list_messages",
      expect.objectContaining({ p_limit: 101 }),
    );
  });
});
