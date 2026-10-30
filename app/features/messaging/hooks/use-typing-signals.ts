import { useEffect, useRef, useState } from "react";

import {
  connectToTypingSignals,
  type TypingSignalConnection,
} from "~/features/messaging/data/subscriptions";

/** 입력하는 동안 신호를 보내는 간격. 신호마다 Realtime 메시지로 과금되므로 글자마다 보내지 않는다. */
const TYPING_SEND_INTERVAL_MS = 3_000;
/** 이 시간 동안 신호가 없으면 상대가 멈춘 것으로 본다. 멈춤 신호를 놓쳐도 표시가 남지 않게 한다. */
const TYPING_EXPIRE_MS = 5_000;

/**
 * 1:1 대화의 입력 중 신호(기능 명세 §13.27). `enabled`가 아니면 채널에 붙지 않아 비용이 들지 않는다.
 */
export function useTypingSignals(
  conversationId: string,
  viewerId: string,
  enabled: boolean,
) {
  const [counterpartTyping, setCounterpartTyping] = useState(false);
  const connection = useRef<TypingSignalConnection | null>(null);
  const lastSentAt = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    const connected = connectToTypingSignals(
      conversationId,
      viewerId,
      (typing) => {
        clearTimeout(expiry);
        setCounterpartTyping(typing);
        if (typing) {
          expiry = setTimeout(
            () => setCounterpartTyping(false),
            TYPING_EXPIRE_MS,
          );
        }
      },
    );
    connection.current = connected;
    return () => {
      clearTimeout(expiry);
      if (lastSentAt.current !== null) connected.send(false);
      lastSentAt.current = null;
      connection.current = null;
      connected.disconnect();
      setCounterpartTyping(false);
    };
  }, [conversationId, viewerId, enabled]);

  const stopTyping = () => {
    if (lastSentAt.current === null) return;
    lastSentAt.current = null;
    connection.current?.send(false);
  };

  /** 입력창의 글이 바뀌었다. 비었으면 멈춘 것이다. */
  const reportDraft = (draft: string) => {
    if (draft.trim() === "") {
      stopTyping();
      return;
    }
    const now = Date.now();
    if (
      lastSentAt.current !== null &&
      now - lastSentAt.current < TYPING_SEND_INTERVAL_MS
    ) {
      return;
    }
    // 채널이 붙기 전에 버려진 신호는 간격을 세지 않아 다음 입력에서 다시 보낸다.
    if (connection.current?.send(true)) lastSentAt.current = now;
  };

  return { counterpartTyping, reportDraft, stopTyping };
}
