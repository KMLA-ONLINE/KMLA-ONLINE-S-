import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TypingSignal } from "~/features/messaging/data/subscriptions";
import { useTypingSignals } from "~/features/messaging/hooks/use-typing-signals";

const send = vi.fn((_signal: TypingSignal) => true);
const disconnect = vi.fn();
const connect = vi.fn();
let receive: (signal: TypingSignal) => void;

vi.mock("~/features/messaging/data/subscriptions", () => ({
  connectToTypingSignals: (
    conversationId: string,
    viewerId: string,
    onSignal: (signal: TypingSignal) => void,
  ) => {
    connect(conversationId, viewerId);
    receive = onSignal;
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
    renderHook(() => useTypingSignals("room", "me", false, undefined));

    expect(connect).not.toHaveBeenCalled();
  });

  it("입력 중에는 3초에 한 번만 보내고, 비우면 멈춤을 한 번 보낸다", () => {
    const { result } = renderHook(() =>
      useTypingSignals("room", "me", true, undefined),
    );

    act(() => {
      result.current.reportDraft("안");
      result.current.reportDraft("안녕");
    });
    expect(send.mock.calls).toEqual([["typing"]]);

    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    act(() => result.current.reportDraft("안녕하"));
    expect(send.mock.calls).toEqual([["typing"], ["typing"]]);

    act(() => {
      result.current.reportDraft("  ");
      result.current.stopTyping();
    });
    expect(send.mock.calls).toEqual([["typing"], ["typing"], ["stopped"]]);
  });

  it("채널이 붙기 전에 버려진 신호는 간격을 세지 않고 다음 입력에서 다시 보낸다", () => {
    const { result } = renderHook(() =>
      useTypingSignals("room", "me", true, undefined),
    );

    send.mockReturnValueOnce(false);
    act(() => result.current.reportDraft("안"));
    act(() => result.current.reportDraft("안녕"));

    expect(send.mock.calls).toEqual([["typing"], ["typing"]]);
  });

  it("상대 신호가 5초 동안 없으면 표시를 지운다", () => {
    const { result } = renderHook(() =>
      useTypingSignals("room", "me", true, undefined),
    );

    act(() => receive("typing"));
    expect(result.current.counterpartTyping).toBe(true);

    act(() => {
      vi.advanceTimersByTime(4_000);
    });
    act(() => receive("typing"));
    act(() => {
      vi.advanceTimersByTime(4_000);
    });
    expect(result.current.counterpartTyping).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(result.current.counterpartTyping).toBe(false);
  });

  it("상대가 멈추면 사라지는 애니메이션을 거쳐 표시를 지운다", () => {
    const { result } = renderHook(() =>
      useTypingSignals("room", "me", true, undefined),
    );

    act(() => receive("typing"));
    act(() => receive("stopped"));
    expect(result.current.counterpartTyping).toBe(false);
    expect(result.current.counterpartLeaving).toBe(true);

    act(() => {
      vi.advanceTimersByTime(160);
    });
    expect(result.current.counterpartLeaving).toBe(false);
  });

  it("사라지는 중에 다시 입력하면 표시를 되살린다", () => {
    const { result } = renderHook(() =>
      useTypingSignals("room", "me", true, undefined),
    );

    act(() => receive("typing"));
    act(() => receive("stopped"));
    act(() => receive("typing"));
    act(() => {
      vi.advanceTimersByTime(160);
    });

    expect(result.current.counterpartTyping).toBe(true);
    expect(result.current.counterpartLeaving).toBe(false);
  });

  it("상대가 보내면 그 메시지가 나타날 때 표시를 거둔다", () => {
    const { result, rerender } = renderHook(
      ({ latest }) => useTypingSignals("room", "me", true, latest),
      { initialProps: { latest: "m1" } },
    );

    act(() => receive("sent"));
    expect(result.current.counterpartTyping).toBe(true);

    rerender({ latest: "m2" });
    expect(result.current.counterpartTyping).toBe(false);
    expect(result.current.counterpartLeaving).toBe(false);
  });

  it("상대가 보낸 뒤 바로 이어 쓰면 메시지가 나타나도 표시를 유지한다", () => {
    const { result, rerender } = renderHook(
      ({ latest }) => useTypingSignals("room", "me", true, latest),
      { initialProps: { latest: "m1" } },
    );

    act(() => receive("sent"));
    act(() => receive("typing"));
    rerender({ latest: "m2" });

    expect(result.current.counterpartTyping).toBe(true);
  });

  it("보낸 메시지가 끝내 오지 않아도 5초 뒤 표시를 지운다", () => {
    const { result } = renderHook(() =>
      useTypingSignals("room", "me", true, undefined),
    );

    act(() => receive("sent"));
    act(() => {
      vi.advanceTimersByTime(5_000);
    });

    expect(result.current.counterpartTyping).toBe(false);
  });

  it("보내면 멈춤 대신 sent를 알리고, 이어 쓰면 간격을 기다리지 않는다", () => {
    const { result } = renderHook(() =>
      useTypingSignals("room", "me", true, undefined),
    );

    act(() => result.current.reportDraft("안녕"));
    act(() => result.current.reportSent());
    act(() => result.current.reportDraft("또"));

    expect(send.mock.calls).toEqual([["typing"], ["sent"], ["typing"]]);
  });

  it("상대가 멈추면 바로 지우고, 방을 떠나면 멈춤을 보내고 끊는다", () => {
    const { result, unmount } = renderHook(() =>
      useTypingSignals("room", "me", true, undefined),
    );

    act(() => receive("typing"));
    act(() => receive("stopped"));

    act(() => result.current.reportDraft("안녕"));
    send.mockClear();
    unmount();

    expect(send.mock.calls).toEqual([["stopped"]]);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
