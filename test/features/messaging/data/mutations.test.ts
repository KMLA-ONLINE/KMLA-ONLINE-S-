import { beforeEach, describe, expect, it, vi } from "vitest";

import { sendMessage } from "~/features/messaging/data/mutations";
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
