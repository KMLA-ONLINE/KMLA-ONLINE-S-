import { useCallback, useEffect, useRef, useState } from "react";

import {
  connectToTypingSignals,
  type TypingSignalConnection,
} from "~/features/messaging/data/subscriptions";

/** 입력하는 동안 신호를 보내는 간격. 신호마다 Realtime 메시지로 과금되므로 글자마다 보내지 않는다. */
const TYPING_SEND_INTERVAL_MS = 3_000;
/** 이 시간 동안 신호가 없으면 상대가 멈춘 것으로 본다. 멈춤 신호를 놓쳐도 표시가 남지 않게 한다. */
const TYPING_EXPIRE_MS = 5_000;
/** 표시가 사라지는 애니메이션 길이. `app.css`의 `typing-leave`와 맞춘다. */
const TYPING_LEAVE_MS = 160;

/**
 * `awaitingMessage`는 상대가 보낸 메시지가 아직 도착하지 않은 동안이고, `leaving`은 표시가 사라지는
 * 애니메이션 동안이다.
 */
type CounterpartState = "idle" | "typing" | "awaitingMessage" | "leaving";

/**
 * 1:1 대화의 입력 중 신호(기능 명세 §13.27). `enabled`가 아니면 채널에 붙지 않아 비용이 들지 않는다.
 * 상대가 보낸 메시지는 신호보다 늦게 도착하므로, 그 메시지가 나타날 때 표시를 거둬 사이가 비지 않게 한다.
 */
export function useTypingSignals(
  conversationId: string,
  viewerId: string,
  enabled: boolean,
  latestCounterpartMessageId: string | undefined,
) {
  const [counterpart, setCounterpart] = useState<CounterpartState>("idle");
  const connection = useRef<TypingSignalConnection | null>(null);
  const lastSentAt = useRef<number | null>(null);

  // 메시지와 표시가 한 번에 바뀌도록 effect가 아니라 렌더 중에 맞춘다.
  const [seenMessageId, setSeenMessageId] = useState(
    latestCounterpartMessageId,
  );
  if (latestCounterpartMessageId !== seenMessageId) {
    setSeenMessageId(latestCounterpartMessageId);
    // 메시지가 표시를 대신하므로 애니메이션 없이 거둔다. 보낸 뒤 바로 다시 입력 중이면 `typing`이라 이어 간다.
    if (counterpart === "awaitingMessage" || counterpart === "leaving") {
      setCounterpart("idle");
    }
  }

  const stopTyping = useCallback(() => {
    if (lastSentAt.current === null) return;
    lastSentAt.current = null;
    connection.current?.send("stopped");
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const leave = () => {
      setCounterpart((current) => (current === "idle" ? "idle" : "leaving"));
      timer = setTimeout(() => setCounterpart("idle"), TYPING_LEAVE_MS);
    };
    const connected = connectToTypingSignals(
      conversationId,
      viewerId,
      (signal) => {
        clearTimeout(timer);
        if (signal === "stopped") {
          leave();
          return;
        }
        setCounterpart(signal === "sent" ? "awaitingMessage" : "typing");
        timer = setTimeout(leave, TYPING_EXPIRE_MS);
      },
    );
    connection.current = connected;
    return () => {
      clearTimeout(timer);
      stopTyping();
      connection.current = null;
      connected.disconnect();
      setCounterpart("idle");
    };
  }, [conversationId, viewerId, enabled, stopTyping]);

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
    if (connection.current?.send("typing")) lastSentAt.current = now;
  };

  /** 쓰던 메시지를 보냈다. 바로 이어 쓰면 다음 입력이 간격을 기다리지 않고 알린다. */
  const reportSent = () => {
    if (lastSentAt.current === null) return;
    lastSentAt.current = null;
    connection.current?.send("sent");
  };

  return {
    counterpartTyping:
      counterpart === "typing" || counterpart === "awaitingMessage",
    counterpartLeaving: counterpart === "leaving",
    reportDraft,
    reportSent,
    stopTyping,
  };
}
