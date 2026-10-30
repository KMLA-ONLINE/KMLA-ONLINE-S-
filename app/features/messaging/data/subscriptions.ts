import { REALTIME_SUBSCRIBE_STATES } from "@supabase/supabase-js";

import { getSupabase } from "~/shared/supabase/client";

/** `content`는 목록의 미리보기나 읽지 않은 수가 바뀔 수 있는 변경이다. 반응·고정은 `meta`다. */
export type MessageChangeKind = "content" | "meta";

export interface MessagingSignalHandlers {
  /** 이 대화의 메시지가 새로 오거나 바뀌었다. */
  onMessageChanged: (conversationId: string, kind: MessageChangeKind) => void;
  /** 소유주가 이 그룹 대화를 지웠다. */
  onConversationDeleted: (conversationId: string) => void;
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
    .on("broadcast", { event: "conversation_deleted" }, ({ payload }) => {
      const conversationId = conversationOf(payload);
      if (active && conversationId) {
        handlers.onConversationDeleted(conversationId);
      }
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

export interface TypingSignalConnection {
  /**
   * 내 입력 상태를 보낸다. 채널이 아직 붙지 않았으면 버리고 `false`를 돌려준다. 놓쳐도 받는 쪽 표시가
   * 저절로 사라진다.
   */
  send: (typing: boolean) => boolean;
  disconnect: () => void;
}

/**
 * 1:1 대화의 입력 중 topic(`messaging-typing:<conversation_id>`)에 붙는다. 신호는 DB에 저장하지 않고
 * 클라이언트끼리 주고받는다. 같은 계정의 다른 기기가 보낸 신호는 거른다.
 */
export function connectToTypingSignals(
  conversationId: string,
  viewerId: string,
  onTypingChanged: (typing: boolean) => void,
): TypingSignalConnection {
  const supabase = getSupabase();
  let active = true;
  let subscribed = false;

  const channel = supabase
    .channel(`messaging-typing:${conversationId}`, {
      config: { private: true },
    })
    .on("broadcast", { event: "typing" }, ({ payload }) => {
      const signal = payload as {
        sender_id?: unknown;
        typing?: unknown;
      } | null;
      if (active && signal?.sender_id !== viewerId) {
        onTypingChanged(signal?.typing === true);
      }
    })
    .subscribe((status) => {
      subscribed = status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED;
    });

  return {
    send(typing) {
      if (!subscribed) return false;
      void channel
        .send({
          type: "broadcast",
          event: "typing",
          payload: { sender_id: viewerId, typing },
        })
        .catch(() => undefined);
      return true;
    },
    disconnect() {
      active = false;
      void supabase.removeChannel(channel);
    },
  };
}

export interface RoomSignalHandlers {
  /** 이 대화의 다른 멤버가 읽음 위치를 옮겼다. */
  onReadChanged: () => void;
  /** 채널이 붙었다. 처음 붙을 때도 부른다. 붙기 전이나 끊긴 동안의 읽음 신호는 잃었을 수 있다. */
  onSubscribed: () => void;
}

/**
 * 열린 대화방의 topic(`messaging-room:<conversation_id>`)으로 오는 읽음 신호를 받는다. 읽음은 방을 연
 * 사람만 그리므로 서버가 멤버마다 보내지 않고 이 topic으로 한 번 보낸다. 내가 읽은 신호는 내 화면의
 * 읽지 않은 수를 바꾸지 않으므로 거른다. private 채널이라 `realtime.messages` RLS가 현재 멤버인지 확인한다.
 */
export function subscribeToRoomSignals(
  conversationId: string,
  viewerProfileId: number,
  handlers: RoomSignalHandlers,
): () => void {
  const supabase = getSupabase();
  let active = true;

  const channel = supabase
    .channel(`messaging-room:${conversationId}`, { config: { private: true } })
    .on("broadcast", { event: "read_changed" }, ({ payload }) => {
      const reader = (payload as { profile_id?: unknown } | null)?.profile_id;
      if (active && reader !== viewerProfileId) handlers.onReadChanged();
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
