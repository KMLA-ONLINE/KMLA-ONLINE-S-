import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTypingSignals } from "~/features/messaging/hooks/use-typing-signals";

const send = vi.fn((_typing: boolean) => true);
const disconnect = vi.fn();
const connect = vi.fn();
let receive: (typing: boolean) => void;

vi.mock("~/features/messaging/data/subscriptions", () => ({
  connectToTypingSignals: (
    conversationId: string,
    viewerId: string,
    onTypingChanged: (typing: boolean) => void,
  ) => {
    connect(conversationId, viewerId);
    receive = onTypingChanged;
    return { send, disconnect };
  },
}));

beforeEach(() => {
  vi.useFakeTimers();
  send.mockClear();
  disconnect.mockClear();
  connect.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useTypingSignals", () => {
  it("꺼져 있으면 채널에 붙지 않는다", () => {
    renderHook(() => useTypingSignals("room", "me", false));

    expect(connect).not.toHaveBeenCalled();
  });

  it("입력 중에는 3초에 한 번만 보내고, 비우면 멈춤을 한 번 보낸다", () => {
    const { result } = renderHook(() => useTypingSignals("room", "me", true));

    act(() => {
      result.current.reportDraft("안");
      result.current.reportDraft("안녕");
    });
    expect(send.mock.calls).toEqual([[true]]);

    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    act(() => result.current.reportDraft("안녕하"));
    expect(send.mock.calls).toEqual([[true], [true]]);

    act(() => {
      result.current.reportDraft("  ");
      result.current.stopTyping();
    });
    expect(send.mock.calls).toEqual([[true], [true], [false]]);
  });

  it("채널이 붙기 전에 버려진 신호는 간격을 세지 않고 다음 입력에서 다시 보낸다", () => {
    const { result } = renderHook(() => useTypingSignals("room", "me", true));

    send.mockReturnValueOnce(false);
    act(() => result.current.reportDraft("안"));
    act(() => result.current.reportDraft("안녕"));

    expect(send.mock.calls).toEqual([[true], [true]]);
  });

  it("상대 신호가 5초 동안 없으면 표시를 지운다", () => {
    const { result } = renderHook(() => useTypingSignals("room", "me", true));

    act(() => receive(true));
    expect(result.current.counterpartTyping).toBe(true);

    act(() => {
      vi.advanceTimersByTime(4_000);
    });
    act(() => receive(true));
    act(() => {
      vi.advanceTimersByTime(4_000);
    });
    expect(result.current.counterpartTyping).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(result.current.counterpartTyping).toBe(false);
  });

  it("상대가 멈추면 바로 지우고, 방을 떠나면 멈춤을 보내고 끊는다", () => {
    const { result, unmount } = renderHook(() =>
      useTypingSignals("room", "me", true),
    );

    act(() => receive(true));
    act(() => receive(false));
    expect(result.current.counterpartTyping).toBe(false);

    act(() => result.current.reportDraft("안녕"));
    send.mockClear();
    unmount();

    expect(send.mock.calls).toEqual([[false]]);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
