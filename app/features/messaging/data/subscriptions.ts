import { REALTIME_SUBSCRIBE_STATES } from "@supabase/supabase-js";

import { getSupabase } from "~/shared/supabase/client";

/** `content`는 목록의 미리보기나 읽지 않은 수가 바뀔 수 있는 변경이다. 반응·고정은 `meta`다. */
export type MessageChangeKind = "content" | "meta";

export interface MessagingSignalHandlers {
  /** 이 대화의 메시지가 새로 오거나 바뀌었다. */
  onMessageChanged: (conversationId: string, kind: MessageChangeKind) => void;
  /** 이 대화의 다른 멤버가 읽음 위치를 옮겼다. */
  onReadChanged: (conversationId: string) => void;
  /**
   * 채널이 붙었다. 처음 붙을 때도 부른다. 대화방 loader가 읽은 뒤 채널이 붙기 전까지, 또는 끊긴
   * 동안의 신호는 잃었을 수 있다.
   */
  onSubscribed: () => void;
}

/**
 * 내 topic(`messaging:<profile_id>`)의 메시지 신호를 받는다. 신호에는 ID만 있고 본문은 따라잡기 RPC로
 * 받는다. private 채널이라 `realtime.messages` RLS가 내 topic인지 확인한다.
 */
export function subscribeToMessagingSignals(
  profileId: number,
  handlers: MessagingSignalHandlers,
): () => void {
  const supabase = getSupabase();
  let active = true;
  const conversationOf = (payload: unknown) => {
    const id = (payload as { conversation_id?: unknown } | null)
      ?.conversation_id;
    return typeof id === "string" ? id : null;
  };

  const channel = supabase
    .channel(`messaging:${profileId}`, { config: { private: true } })
    .on("broadcast", { event: "message_changed" }, ({ payload }) => {
      const conversationId = conversationOf(payload);
      // 종류를 모르는 신호는 더 넓은 쪽(`content`)으로 다룬다.
      const kind =
        (payload as { kind?: unknown } | null)?.kind === "meta"
          ? "meta"
          : "content";
      if (active && conversationId) {
        handlers.onMessageChanged(conversationId, kind);
      }
    })
    .on("broadcast", { event: "read_changed" }, ({ payload }) => {
      const conversationId = conversationOf(payload);
      if (active && conversationId) handlers.onReadChanged(conversationId);
    })
    .subscribe((status) => {
      if (active && status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
        handlers.onSubscribed();
      }
    });

  return () => {
    active = false;
    void supabase.removeChannel(channel);
  };
}
