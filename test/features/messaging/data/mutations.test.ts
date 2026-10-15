import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  SEND_TARGET_LIMIT,
  sendMessage,
  sendToConversations,
} from "~/features/messaging/data/mutations";
import type { ConversationMessage } from "~/features/messaging/model/types";

const rpc = vi.fn();

vi.mock("~/shared/supabase/client", () => ({
  getSupabase: () => ({ rpc }),
}));

const draft: ConversationMessage = {
  id: "e0000000-0000-0000-0000-000000000001",
  senderId: "1",
  body: "안녕",
  sentAt: "2026-08-28T06:00:00.000Z",
  replyTo: { id: "a", senderId: "2", body: "원문" },
  unreadMemberCount: 1,
};

beforeEach(() => {
  rpc.mockReset();
});

describe("sendMessage", () => {
  it("초안을 서버가 정한 전송 시각으로 확정하고 인용은 그대로 둔다", async () => {
    rpc.mockResolvedValue({
      data: [{ id: draft.id, sent_at: "2026-08-28T06:00:01.123456+00:00" }],
      error: null,
    });

    const sent = await sendMessage(
      {
        conversationId: "c",
        id: draft.id,
        body: "안녕",
        replyToMessageId: "a",
      },
      draft,
    );

    expect(rpc).toHaveBeenCalledWith("send_message", {
      p_conversation_id: "c",
      p_message_id: draft.id,
      p_body: "안녕",
      p_reply_to_id: "a",
    });
    expect(sent).toEqual({
      ...draft,
      sentAt: "2026-08-28T06:00:01.123456+00:00",
    });
  });

  it("저장된 행이 오지 않으면 실패로 본다", async () => {
    rpc.mockResolvedValue({ data: [], error: null });

    await expect(
      sendMessage({ conversationId: "c", id: draft.id, body: "안녕" }, draft),
    ).rejects.toThrow();
  });
});

describe("sendToConversations", () => {
  const LINK = "https://kmla.online/groups/band/posts/1";

  function rpcCalls(name: string) {
    return (rpc.mock.calls as [string, Record<string, unknown>][]).filter(
      ([called]) => called === name,
    );
  }

  it("대화가 없는 사람은 1:1 대화를 열고, 같은 대화로 겹친 대상에는 한 번만 보낸다", async () => {
    rpc.mockImplementation((name: string, args: Record<string, unknown>) => {
      if (name === "open_direct_conversation") {
        return Promise.resolve({
          data: args.p_profile_id === 7 ? "direct-7" : "direct-9",
          error: null,
        });
      }
      return Promise.resolve({
        data: [{ id: args.p_message_id, sent_at: "2026-10-15T00:00:00Z" }],
        error: null,
      });
    });

    const result = await sendToConversations(
      [
        { type: "conversation", conversationId: "group-1" },
        { type: "conversation", conversationId: "direct-7" },
        { type: "person", profileId: "7" },
        { type: "person", profileId: "9" },
      ],
      LINK,
    );

    expect(result).toEqual({ sent: 3, failed: 0 });
    const sends = rpcCalls("send_message").map(([, args]) => args);
    expect(sends.map((args) => args.p_conversation_id).sort()).toEqual([
      "direct-7",
      "direct-9",
      "group-1",
    ]);
    expect(sends.every((args) => args.p_body === LINK)).toBe(true);
    // 방을 열지 않고 보내므로 그 방의 안 읽은 메시지를 읽음으로 만들지 않는다.
    expect(sends.every((args) => args.p_mark_read === false)).toBe(true);
    expect(new Set(sends.map((args) => args.p_message_id)).size).toBe(3);
  });

  it("일부 대상이 실패해도 나머지에는 보내고 실패한 수를 센다", async () => {
    rpc.mockImplementation((name: string, args: Record<string, unknown>) => {
      if (name === "open_direct_conversation") {
        return Promise.resolve({ data: null, error: new Error("blocked") });
      }
      if (args.p_conversation_id === "left") {
        return Promise.resolve({ data: null, error: new Error("not member") });
      }
      return Promise.resolve({
        data: [{ id: args.p_message_id, sent_at: "2026-10-15T00:00:00Z" }],
        error: null,
      });
    });

    const result = await sendToConversations(
      [
        { type: "conversation", conversationId: "ok" },
        { type: "conversation", conversationId: "left" },
        { type: "person", profileId: "3" },
      ],
      LINK,
    );

    expect(result).toEqual({ sent: 1, failed: 2 });
  });

  it("refuses more than 10 targets before sending anything", async () => {
    const targets = Array.from({ length: 11 }, (_, index) => ({
      type: "conversation" as const,
      conversationId: `c${index}`,
    }));

    expect(SEND_TARGET_LIMIT).toBe(10);
    await expect(sendToConversations(targets, LINK)).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("reuses each conversation's message id when retrying, so a lost response cannot duplicate", async () => {
    let lose = true;
    rpc.mockImplementation((name: string, args: Record<string, unknown>) => {
      if (name === "open_direct_conversation") {
        return Promise.resolve({ data: "direct-7", error: null });
      }
      // 첫 시도는 서버에 저장됐지만 응답이 끊긴 것처럼 실패한다.
      if (lose) return Promise.reject(new TypeError("Failed to fetch"));
      return Promise.resolve({
        data: [{ id: args.p_message_id, sent_at: "2026-10-15T00:00:00Z" }],
        error: null,
      });
    });
    const messageIds = new Map<string, string>();
    const targets = [
      { type: "conversation" as const, conversationId: "group-1" },
      { type: "person" as const, profileId: "7" },
    ];

    await expect(
      sendToConversations(targets, LINK, messageIds),
    ).resolves.toEqual({ sent: 0, failed: 2 });
    lose = false;
    await expect(
      sendToConversations(targets, LINK, messageIds),
    ).resolves.toEqual({ sent: 2, failed: 0 });

    const idsByConversation = new Map<string, Set<unknown>>();
    for (const [, args] of rpcCalls("send_message")) {
      const conversationId = String(args.p_conversation_id);
      const ids = idsByConversation.get(conversationId) ?? new Set();
      ids.add(args.p_message_id);
      idsByConversation.set(conversationId, ids);
    }
    expect([...idsByConversation.values()].map((ids) => ids.size)).toEqual([
      1, 1,
    ]);
  });
});
